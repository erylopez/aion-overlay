"""Server->client TCP payloads of the game flow, live through Npcap or from a saved .pcap.

The game flow is found the way the DPS meters find it: the server port whose payloads keep
carrying the stream's record terminator. A per-flow sequence check drops retransmissions.

Live capture listens on every adapter that has an address at once: with a VPN or a ping reducer
the game's traffic is only readable on the tunnel adapter, which is not Windows' default one.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Iterator

from scapy.all import IP, TCP, AsyncSniffer, PcapReader, conf

from . import protocol

LOCK_HITS = 12  # signature-bearing packets ...
LOCK_WINDOW_S = 3.0  # ... within this long, from one flow, lock onto it
HOLD_LIMIT = 4 * 1024 * 1024  # bytes kept per flow while waiting for the lock
REPORT_S = 30.0  # until the lock, how often the log says what each adapter is seeing


class Reassembler:
    """One flow's byte stream: in-order payloads appended, packets split off the front."""

    def __init__(self) -> None:
        self.buf = b""
        self.next_seq: int | None = None
        self.pending: dict[int, bytes] = {}

    def feed(self, seq: int, data: bytes) -> list[bytes]:
        if self.next_seq is None:
            self.next_seq = seq
        delta = (seq - self.next_seq) & 0xFFFFFFFF
        if delta == 0:
            self._append(data)
        elif delta < 0x80000000:  # ahead: hold until the gap fills (or give up past 64 KB)
            self.pending[seq] = data
            if sum(map(len, self.pending.values())) <= 65536:
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
        self.flows: dict[tuple[str, int, str, int], Reassembler] = {}
        self.hits: dict[tuple[str, int], list[float]] = {}
        # Until a flow is known to be the game, its segments are held here, so that what it sent
        # before the lock (a login's character and collection data) is not lost.
        self.held: dict[tuple[str, int, str, int], list[tuple]] = {}
        self.held_bytes: dict[tuple[str, int, str, int], int] = {}

    def segment(self, ts: float, src: str, sport: int, dst: str, dport: int, seq: int, data: bytes) -> None:
        if not data:
            return
        key = (src, sport, dst, dport)
        if self.port is None:
            self._hold(key, (ts, seq, data))
            if not any(sig in data for sig in protocol.GAME_SIGNATURES):
                return
            times = [t for t in self.hits.get((src, sport), []) if ts - t <= LOCK_WINDOW_S] + [ts]
            self.hits[(src, sport)] = times
            if len(times) < LOCK_HITS:
                return
            self.port = sport
            self.on_lock(src, sport)
            held = {k: v for k, v in self.held.items() if k[1] == sport}
            self.held.clear()
            self.held_bytes.clear()
            for k, segs in held.items():
                for t, s, d in segs:
                    self._feed(k, t, s, d)
            return  # this segment was the last one held
        if sport != self.port:
            return
        self._feed(key, ts, seq, data)

    def _hold(self, key, seg) -> None:
        if key not in self.held:
            if seg[2][:3] in (b"\x17\x03\x03", b"\x16\x03\x01", b"\x16\x03\x03"):
                self.held_bytes[key] = HOLD_LIMIT  # TLS: never the game, never held
            self.held[key] = []
        if self.held_bytes.get(key, 0) + len(seg[2]) > HOLD_LIMIT:
            return
        self.held[key].append(seg)
        self.held_bytes[key] = self.held_bytes.get(key, 0) + len(seg[2])

    def _feed(self, key, ts: float, seq: int, data: bytes) -> None:
        flow = self.flows.setdefault(key, Reassembler())
        for pkt in flow.feed(seq, data):
            self.on_packet(ts, pkt)


def _segments(packets) -> Iterator[tuple]:
    for p in packets:
        if IP in p and TCP in p:
            ip, t = p[IP], p[TCP]
            # Trim to the IP length: short frames carry Ethernet padding that scapy leaves on
            # the TCP payload, and it would be read as stream bytes.
            size = ip.len - ip.ihl * 4 - t.dataofs * 4
            data = bytes(t.payload)[: max(size, 0)]
            yield float(p.time), ip.src, t.sport, ip.dst, t.dport, t.seq, data


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


def live(stream: GameStream, iface: str | None = None, save_to: str | None = None,
         stop: threading.Event | None = None, log: Callable[[str], None] = print) -> None:
    """Runs until Ctrl+C, or until `stop` is set. Listens on every adapter (see pick_interfaces)
    unless `iface` names one. `save_to` also writes everything captured to a .pcap for later
    replay."""
    from scapy.utils import PcapWriter

    sockets = {conf.L2listen(iface=iface, filter="tcp"): iface} if iface else _open(log)
    writer = PcapWriter(save_to, append=True, sync=True) if save_to else None
    counts = {name: 0 for name in sockets.values()}  # TCP packets per adapter since the last report

    def handle(p):
        if writer is not None:
            writer.write(p)
        counts[p.sniffed_on] += 1
        for seg in _segments([p]):
            locked = stream.port is not None
            stream.segment(*seg)
            if not locked and stream.port is not None:
                log(f"[capture] the game stream is on {p.sniffed_on}")

    def report() -> None:
        seen = ", ".join(f"{name} {n}" for name, n in counts.items())
        log(f"[capture] no game stream yet; TCP packets in the last {REPORT_S:.0f}s: {seen}")
        for name in counts:
            counts[name] = 0

    halt = stop or threading.Event()
    sniffer = AsyncSniffer(opened_socket=sockets, prn=handle, store=False)
    started = next_report = time.monotonic()
    next_report += REPORT_S
    sniffer.start()
    try:
        # Short waits, so Ctrl+C gets through on Windows.
        while not halt.wait(1.0):
            if not sniffer.thread.is_alive():
                raise RuntimeError(f"capture ended on its own: {sniffer.exception or 'every adapter failed'}")
            if stream.port is None and time.monotonic() >= next_report:
                report()
                next_report += REPORT_S
    except KeyboardInterrupt:
        pass
    finally:
        if sniffer.thread.is_alive():
            sniffer.stop()
        for sock in sockets:
            sock.close()
        if writer is not None:
            writer.close()
        log(f"[capture] stopped after {time.monotonic() - started:.0f}s")
