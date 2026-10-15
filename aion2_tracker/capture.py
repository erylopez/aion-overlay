"""Server->client TCP payloads of the game flow, live through Npcap or from a saved .pcap.

The game flow is found the way the DPS meters find it: the server port whose payloads keep
carrying the stream's record terminator. A per-flow sequence check drops retransmissions.

The lock follows the game: when the locked flow goes quiet and another flow carries the game's
terminator, the game has moved to that connection (character select into the world, a reconnect,
another server) and the stream locks onto it instead. Flows that are not the game are held a
while, so the one locked onto later keeps what it sent first (a login's collection data).

Live capture listens on every adapter that has an address at once: with a VPN or a ping reducer
the game's traffic is only readable on the tunnel adapter, which is not Windows' default one. Each
adapter is read by its own thread, and frames are decoded from their bytes, not by scapy: scapy's
one loop over every adapter waited out a quiet adapter's 100 ms read timeout between packets of
the busy one, ~10 packets a second in all, and Npcap dropped the rest of the game's traffic.
"""

from __future__ import annotations

import socket
import struct
import threading
import time
from collections.abc import Callable, Iterator
from ctypes import byref

from scapy.all import IP, TCP, IPv6, PcapReader, conf

from . import protocol

LOCK_HITS = 12  # signature-bearing packets ...
LOCK_WINDOW_S = 3.0  # ... within this long, from one flow, lock onto it
# The locked flow carries its terminator ~19x/s even idle: silent this long while another flow
# looks like the game, the game has moved there.
RELOCK_SILENCE_S = 5.0
HOLD_LIMIT = 4 * 1024 * 1024  # bytes kept per flow that is not (yet) the game
HOLD_IDLE_S = 30.0  # a held flow that sent nothing for this long is dropped
PRUNE_EVERY_S = 10.0
# A missing segment not filled within this long never will be: TCP resends what the network lost
# well within it, and what the capture missed (the game did receive it) is never resent. Waiting on
# bytes alone stalled a quiet stream (~0.4 KB/s idle) for minutes.
GAP_WAIT_S = 2.0
GAP_WAIT_BYTES = 65536
REPORT_S = 30.0  # while there is no game stream, how often the log says what each adapter sees
QUIET_S = 15.0  # the locked flow silent this long counts as no game stream, for the reports
KERNEL_BUFFER = 16 * 1024 * 1024  # Npcap's buffer per adapter (1 MB by default): room for bursts

FlowKey = tuple[str, int, str, int]


class Reassembler:
    """One flow's byte stream: in-order payloads appended, packets split off the front."""

    def __init__(self) -> None:
        self.buf = b""
        self.next_seq: int | None = None
        self.pending: dict[int, bytes] = {}
        self.gap_since: float | None = None  # capture time the current gap opened

    def feed(self, ts: float, seq: int, data: bytes) -> list[bytes]:
        if self.next_seq is None:
            self.next_seq = seq
        delta = (seq - self.next_seq) & 0xFFFFFFFF
        if delta == 0:
            self._append(data)
        elif delta < 0x80000000:  # ahead: hold until the gap fills, or give up on it
            self.pending[seq] = data
            if self.gap_since is None:
                self.gap_since = ts
            if sum(map(len, self.pending.values())) <= GAP_WAIT_BYTES and ts - self.gap_since < GAP_WAIT_S:
                return []
            self._resync()
        else:  # behind: a retransmission, keep only bytes we have not seen
            skip = (self.next_seq - seq) & 0xFFFFFFFF
            if skip >= len(data):
                return []
            self._append(data[skip:])
        # What was held and now lines up: after the gap filled, or after giving up on it. (Only
        # draining on an exact arrival stalled the stream for good after a resync, whose first
        # held segment had already arrived.)
        self._drain()
        self.gap_since = ts if self.pending else None
        packets, consumed = protocol.split(self.buf)
        self.buf = self.buf[consumed:]
        if len(self.buf) > 2 * 1024 * 1024:
            self.buf = b""
        return packets

    def _append(self, data: bytes) -> None:
        self.buf += data
        self.next_seq = (self.next_seq + len(data)) & 0xFFFFFFFF

    def _drain(self) -> None:
        while True:
            # Held segments now (partly) behind the stream: keep only their new bytes, or drop
            # them, so none is held for ever.
            for s in [s for s in self.pending if (s - self.next_seq) & 0xFFFFFFFF >= 0x80000000]:
                data = self.pending.pop(s)
                skip = (self.next_seq - s) & 0xFFFFFFFF
                if skip < len(data) and len(data) - skip > len(self.pending.get(self.next_seq, b"")):
                    self.pending[self.next_seq] = data[skip:]
            if self.next_seq not in self.pending:
                return
            self._append(self.pending.pop(self.next_seq))

    def _resync(self) -> None:
        # Lost a segment for good: drop what is buffered and restart at the earliest held one.
        self.buf = b""
        first = min(self.pending, key=lambda s: (s - self.next_seq) & 0xFFFFFFFF)
        self.next_seq = first


class GameStream:
    """Feeds raw TCP segments in, hands game packets (with their capture time) out."""

    def __init__(self, on_packet: Callable[[float, bytes], None], server_port: int | None = None,
                 on_lock: Callable[[str, int], None] | None = None):
        self.on_packet = on_packet
        self.port = server_port
        self.on_lock = on_lock or (lambda host, port: print(f"[capture] game stream locked: server {host}:{port}"))
        self.flows: dict[FlowKey, Reassembler] = {}
        self.hits: dict[tuple[str, int], list[float]] = {}
        # Flows not (yet) known to be the game: their segments, so that what one sent before it is
        # locked onto (a login's character and collection data) is not lost.
        self.held: dict[FlowKey, list[tuple]] = {}
        self.held_bytes: dict[FlowKey, int] = {}
        self.held_last: dict[FlowKey, float] = {}
        self.last_game: float | None = None  # capture time of the locked flow's last segment
        self.pruned_at = 0.0
        # Terminator-bearing segments per flow other than the locked one, since the last report.
        self.candidates: dict[tuple[str, int], int] = {}

    def silent_for(self, now: float) -> float | None:
        """Seconds since the locked flow last sent anything; None before the first lock."""
        return None if self.last_game is None else now - self.last_game

    def segment(self, ts: float, src: str, sport: int, dst: str, dport: int, seq: int, data: bytes) -> None:
        if not data:
            return
        key = (src, sport, dst, dport)
        if self.port is not None and sport == self.port:
            self.last_game = ts
            self._feed(key, ts, seq, data)
            return
        self._hold(key, (ts, seq, data))
        self._prune(ts)
        if not any(sig in data for sig in protocol.GAME_SIGNATURES):
            return
        self.candidates[(src, sport)] = self.candidates.get((src, sport), 0) + 1
        times = [t for t in self.hits.get((src, sport), []) if ts - t <= LOCK_WINDOW_S] + [ts]
        self.hits[(src, sport)] = times
        if len(times) < LOCK_HITS:
            return
        if self.last_game is not None and ts - self.last_game < RELOCK_SILENCE_S:
            return  # the locked flow is alive: this one is something else
        self._lock(ts, src, sport)

    def _lock(self, ts: float, src: str, sport: int) -> None:
        self.port = sport
        self.last_game = ts
        self.on_lock(src, sport)
        # A new lock is a new connection: the old flows' streams are done with.
        self.flows = {k: f for k, f in self.flows.items() if k[1] == sport}
        held = {k: v for k, v in self.held.items() if k[1] == sport}
        for k in held:
            self._unhold(k)
        for k, segs in held.items():
            for t, s, d in segs:
                self._feed(k, t, s, d)
        # (The segment that made the lock was the last one held.)

    def _hold(self, key: FlowKey, seg: tuple) -> None:
        self.held_last[key] = seg[0]
        if key not in self.held:
            if seg[2][:3] in (b"\x17\x03\x03", b"\x16\x03\x01", b"\x16\x03\x03"):
                self.held_bytes[key] = HOLD_LIMIT  # TLS: never the game, never held
            self.held[key] = []
        if self.held_bytes.get(key, 0) + len(seg[2]) > HOLD_LIMIT:
            return
        self.held[key].append(seg)
        self.held_bytes[key] = self.held_bytes.get(key, 0) + len(seg[2])

    def _unhold(self, key: FlowKey) -> None:
        self.held.pop(key, None)
        self.held_bytes.pop(key, None)
        self.held_last.pop(key, None)

    def _prune(self, ts: float) -> None:
        """Forget flows that went quiet: holding stays bounded however long the capture runs."""
        if ts - self.pruned_at < PRUNE_EVERY_S:
            return
        self.pruned_at = ts
        for k in [k for k, t in self.held_last.items() if ts - t > HOLD_IDLE_S]:
            self._unhold(k)
        for k in [k for k, t in self.hits.items() if ts - t[-1] > LOCK_WINDOW_S]:
            del self.hits[k]

    def _feed(self, key: FlowKey, ts: float, seq: int, data: bytes) -> None:
        flow = self.flows.setdefault(key, Reassembler())
        for pkt in flow.feed(ts, seq, data):
            self.on_packet(ts, pkt)


def _segments(packets) -> Iterator[tuple]:
    for p in packets:
        if TCP not in p:
            continue
        t = p[TCP]
        # Trim to the IP length: short frames carry Ethernet padding that scapy leaves on the TCP
        # payload, and it would be read as stream bytes.
        if IP in p:
            ip = p[IP]
            size = ip.len - ip.ihl * 4 - t.dataofs * 4
        elif IPv6 in p:
            ip = p[IPv6]
            size = ip.plen - t.dataofs * 4
        else:
            continue
        data = bytes(t.payload)[: max(size, 0)]
        yield float(p.time), ip.src, t.sport, ip.dst, t.dport, t.seq, data


# Link types whose frames _decode reads itself; any other goes through scapy.
DLT_ETHERNET, DLT_NULL, DLT_LOOP = 1, 0, 108
DLT_RAW = (12, 14, 101, 228, 229)
DECODED = (DLT_ETHERNET, DLT_NULL, DLT_LOOP, *DLT_RAW)


def _ip_at(linktype: int, raw: bytes) -> int | None:
    """Where the IP header starts in a frame of this link type; None if it carries no IP."""
    if linktype == DLT_ETHERNET:
        at, ethertype = 14, raw[12:14]
        while ethertype in (b"\x81\x00", b"\x88\xa8") and len(raw) >= at + 4:  # VLAN tags
            ethertype, at = raw[at + 2 : at + 4], at + 4
        return at if ethertype in (b"\x08\x00", b"\x86\xdd") else None
    if linktype in (DLT_NULL, DLT_LOOP):  # loopback: a 4-byte address family first
        return 4
    return 0 if linktype in DLT_RAW else None


def _decode(linktype: int, ts: float, raw: bytes) -> tuple | None:
    """A TCP frame as (ts, src, sport, dst, dport, seq, payload), read from its bytes."""
    at = _ip_at(linktype, raw)
    if at is None or len(raw) < at + 20:
        return None
    version = raw[at] >> 4
    if version == 4:
        if raw[at + 9] != 6 or struct.unpack_from("!H", raw, at + 6)[0] & 0x1FFF:
            return None  # not TCP, or a fragment after the first
        total = struct.unpack_from("!H", raw, at + 2)[0]
        end = at + total if total else len(raw)  # 0: segmentation offload, the frame says how long
        src, dst = socket.inet_ntoa(raw[at + 12 : at + 16]), socket.inet_ntoa(raw[at + 16 : at + 20])
        tcp = at + (raw[at] & 0x0F) * 4
    elif version == 6:
        if len(raw) < at + 40 or raw[at + 6] != 6:
            return None  # not TCP (or behind extension headers, which the game's flow never has)
        plen = struct.unpack_from("!H", raw, at + 4)[0]
        end = at + 40 + plen if plen else len(raw)
        src = socket.inet_ntop(socket.AF_INET6, raw[at + 8 : at + 24])
        dst = socket.inet_ntop(socket.AF_INET6, raw[at + 24 : at + 40])
        tcp = at + 40
    else:
        return None
    if len(raw) < tcp + 20:
        return None
    sport, dport, seq = struct.unpack_from("!HHI", raw, tcp)
    return ts, src, sport, dst, dport, seq, raw[tcp + (raw[tcp + 12] >> 4) * 4 : end]


def replay(path: str, stream: GameStream, speed: float | None = None,
           stop: threading.Event | None = None) -> None:
    """Feed a saved capture through `stream`. With `speed`, at that multiple of real time (for
    trying the overlay without the game); without it, as fast as it reads."""
    first = started = None
    with PcapReader(path) as reader:
        for seg in _segments(reader):
            if stop is not None and stop.is_set():
                return
            if speed:
                first = seg[0] if first is None else first
                started = time.monotonic() if started is None else started
                wait = (seg[0] - first) / speed - (time.monotonic() - started)
                if wait > 0:
                    time.sleep(wait)
            stream.segment(*seg)


def pick_interfaces(ifaces) -> list:
    """The adapters worth listening on: valid ones with an IPv4 address that is not link-local.
    That keeps the connected adapters, VPN tunnels and loopback (some ping reducers proxy through
    it), and leaves out disconnected Wi-Fi, Bluetooth and WAN miniports. Empty if none qualify."""
    return [i for i in ifaces
            if i.is_valid() and any(not ip.startswith("169.254.") for ip in i.ips.get(4, []))]


def _open(log: Callable[[str], None]) -> dict:
    """{socket: adapter name} for every adapter that opens; raises if none does."""
    chosen = pick_interfaces(conf.ifaces.values()) or [conf.iface]
    sockets, opened, failed = {}, [], []
    for iface in chosen:
        try:
            sockets[conf.L2listen(iface=iface, filter="tcp")] = iface.name
            opened.append(f"{iface.name} ({iface.description}, {', '.join(iface.ips.get(4, []))})")
        except Exception as e:  # noqa: BLE001 -- one bad adapter must not stop the others
            failed.append(f"{iface.name}: {e}")
            log(f"[capture] could not open {failed[-1]}")
    if not sockets:
        raise RuntimeError("no network adapter could be opened (" + "; ".join(failed) + ")")
    log(f"[capture] listening on {len(opened)} adapter(s): " + "; ".join(opened))
    return sockets


def _linktype(sock) -> int | None:
    try:
        return int(sock.pcap_fd.datalink())
    except Exception:  # noqa: BLE001 -- not an Npcap socket: scapy decodes its frames
        return None


def _enlarge_buffer(sock) -> None:
    try:
        from scapy.libs.winpcapy import pcap_setbuff  # Npcap only
        pcap_setbuff(sock.pcap_fd.pcap, KERNEL_BUFFER)
    except Exception:  # noqa: BLE001 -- the default buffer still works
        pass


def _drops(sock) -> int | None:
    """Packets Npcap dropped on this adapter since it was opened (its buffer was full)."""
    try:
        from scapy.libs.winpcapy import pcap_stat, pcap_stats
        stat = pcap_stat()
        return int(stat.ps_drop) if pcap_stats(sock.pcap_fd.pcap, byref(stat)) == 0 else None
    except Exception:  # noqa: BLE001
        return None


def live(stream: GameStream, iface: str | None = None, save_to: str | None = None,
         stop: threading.Event | None = None, log: Callable[[str], None] = print) -> None:
    """Runs until Ctrl+C, or until `stop` is set. Listens on every adapter (see pick_interfaces)
    unless `iface` names one, each from its own thread. `save_to` also writes everything captured
    to a .pcap for later replay."""
    from scapy.utils import PcapWriter

    sockets = {conf.L2listen(iface=iface, filter="tcp"): iface} if iface else _open(log)
    for sock in sockets:
        _enlarge_buffer(sock)
    writer = PcapWriter(save_to, append=True, sync=True) if save_to else None
    halt = stop or threading.Event()
    done = threading.Event()
    # One segment at a time into the stream, whichever adapter it came from. The counters and the
    # stream's candidates are read under it too.
    lock = threading.Lock()
    counts = {name: 0 for name in sockets.values()}  # TCP packets per adapter since the last report
    dropped = {name: _drops(sock) for sock, name in sockets.items()}  # Npcap's count at the last report
    failed: dict[str, str] = {}
    errors = [0]  # packets the stream or the tracker failed on; the first few are logged

    def read(sock, name: str) -> None:
        linktype = _linktype(sock)
        try:
            while not (halt.is_set() or done.is_set()):
                asked = time.monotonic()
                cls, raw, ts = sock.recv_raw()  # Npcap: up to 100 ms, then None
                if raw is None:
                    if time.monotonic() - asked < 0.001:
                        time.sleep(0.01)  # an error at once, not the read timeout: do not spin
                    continue
                if linktype in DECODED:
                    seg = _decode(linktype, ts, raw)
                else:
                    pkt = cls(raw)
                    pkt.time = ts
                    seg = next(_segments([pkt]), None)
                with lock:
                    counts[name] += 1
                    if writer is not None:
                        pkt = cls(raw)
                        pkt.time = ts
                        writer.write(pkt)
                    if seg is None:
                        continue
                    before = stream.port
                    try:
                        stream.segment(*seg)
                    except Exception as e:  # noqa: BLE001 -- one odd packet must not end the capture
                        errors[0] += 1
                        if errors[0] <= 5:
                            log(f"[capture] packet from {seg[1]}:{seg[2]} failed: {type(e).__name__}: {e}")
                        continue
                    if stream.port != before:
                        was = f" (was port {before})" if before is not None else ""
                        log(f"[capture] game stream locked on {name}: server {seg[1]}:{stream.port}{was}")
        except Exception as e:  # noqa: BLE001 -- one adapter failing must not stop the others
            if not (halt.is_set() or done.is_set()):
                failed[name] = f"{type(e).__name__}: {e}"
                log(f"[capture] stopped listening on {name}: {failed[name]}")

    def quiet_for() -> float | None:
        """Seconds the game stream has been missing: never locked, or the locked flow silent."""
        if stream.port is None:
            return time.monotonic() - started
        silent = stream.silent_for(time.time())
        return silent if silent is not None and silent >= QUIET_S else None

    def report(quiet: float | None) -> None:
        with lock:
            seen = ", ".join(f"{name} {n}" for name, n in counts.items())
            top = sorted(stream.candidates.items(), key=lambda kv: -kv[1])[:5]
            for name in counts:
                counts[name] = 0
            stream.candidates.clear()
        lost = []
        for sock, name in sockets.items():
            now = _drops(sock)
            if now is not None and dropped[name] is not None and now > dropped[name]:
                lost.append(f"{name} {now - dropped[name]}")
            dropped[name] = now
        if quiet is None:
            if lost:  # the game is tracked, but some of it may be missing
                log(f"[capture] Npcap dropped packets in the last {REPORT_S:.0f}s: {', '.join(lost)}")
            return
        what = "no game stream yet" if stream.port is None else f"the game stream (port {stream.port}) silent for {quiet:.0f}s"
        flows = ", ".join(f"{h}:{port} {n}" for (h, port), n in top) or "none"
        log(f"[capture] {what}; TCP packets in the last {REPORT_S:.0f}s: {seen}; "
            f"flows carrying the game's terminator: {flows}; dropped by Npcap: {', '.join(lost) or 'none'}")

    threads = [threading.Thread(target=read, args=(sock, name), name=f"capture {name}", daemon=True)
               for sock, name in sockets.items()]
    started = next_report = time.monotonic()
    next_report += REPORT_S
    for t in threads:
        t.start()
    try:
        # Short waits, so Ctrl+C gets through on Windows.
        while not halt.wait(1.0):
            if len(failed) == len(sockets):
                raise RuntimeError("capture ended on its own: " + "; ".join(f"{n}: {e}" for n, e in failed.items()))
            if time.monotonic() >= next_report:
                report(quiet_for())
                next_report += REPORT_S
    except KeyboardInterrupt:
        pass
    finally:
        done.set()
        for t in threads:
            t.join(timeout=2.0)
        for sock in sockets:
            sock.close()
        if writer is not None:
            writer.close()
        log(f"[capture] stopped after {time.monotonic() - started:.0f}s")
