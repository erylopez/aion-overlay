"""Hunt for the soul-drop packet in a capture.

Every kill of a pet monster *may* drop a soul. So whatever packet carries the drop should follow
some of your kills and not others, and never follow another player's kill. This replays a capture,
finds your kills (the `04 8D` loot-owner record names you), and lists, for each opcode, how many of
your kills vs. others' kills were followed by it within a short window.

    python -m aion2_tracker.analyze captures/kills1.pcap [--window 3] [--dump 42,36]
"""

from __future__ import annotations

import argparse
import collections
import json
from dataclasses import dataclass, field
from pathlib import Path

from . import capture, protocol as P

NPCS_DEFAULT = Path(__file__).resolve().parents[1] / "data" / "npcs_en.json"


def spawns_default() -> Path:
    """questlog.gg's soul droppers (pet -> monsters), as the app keeps them; the packaged helper
    carries a copy in data/."""
    root = Path(__file__).resolve().parents[1]
    repo = root / "app" / "src" / "renderer" / "public" / "maps" / "spawns.json"
    return repo if repo.exists() else root / "data" / "spawns.json"


def pets_default() -> Path:
    """questlog.gg's pet list (id, name, genus), as the app keeps it; the packaged helper carries a
    copy in data/."""
    root = Path(__file__).resolve().parents[1]
    repo = root / "app" / "src" / "renderer" / "src" / "data" / "pets.json"
    return repo if repo.exists() else root / "data" / "pets.json"


def load_genera(path: Path | None = None) -> dict[int, str]:
    """Pet id -> genus ("fera", "cogni", ...). Empty if missing."""
    try:
        pets = json.loads(Path(path or pets_default()).read_text(encoding="utf-8"))["pets"]
    except (OSError, ValueError, KeyError):
        return {}
    return {int(p["id"]): p["genus"] for p in pets if p.get("genus")}


def load_droppers(path: Path | None = None) -> dict[int, int]:
    """Monster code -> the pet whose soul it drops (each monster drops one). Empty if missing."""
    path = path or spawns_default()
    try:
        pets = json.loads(Path(path).read_text(encoding="utf-8"))["pets"]
    except (OSError, ValueError, KeyError):
        return {}
    return {d["npc"]: int(pid) for pid, droppers in pets.items() for d in droppers}


@dataclass
class Kill:
    ts: float
    mob_id: int
    mob_code: int | None
    attackers: set[int]
    loot_owner: tuple[int, str] | None = None
    after: list[tuple[float, bytes]] = field(default_factory=list)


def loot_owner_records(pkt: bytes):
    """`04 8D <mob varint> <owner varint> <server u16 LE> <u8 len><utf8 name>` anywhere in `pkt`."""
    i = 0
    while (i := pkt.find(b"\x04\x8d", i)) >= 0:
        i += 2
        mob, n = P.read_varint(pkt, i)
        if not n or not 100 <= mob <= 9_999_999:
            continue
        j = i + n + 4  # a u32: a skill id for a summon, 0 otherwise
        owner, n2 = P.read_varint(pkt, j)
        if not n2:
            continue
        j += n2 + 2
        if j >= len(pkt):
            continue
        ln = pkt[j]
        raw = pkt[j + 1 : j + 1 + ln]
        if not 1 <= ln <= 36 or len(raw) != ln:
            continue
        try:
            name = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if name.isprintable():
            yield mob, owner, name


def run(path: str, window: float) -> tuple[list[Kill], collections.Counter, collections.Counter]:
    mob_code: dict[int, int | None] = {}
    attackers: dict[int, set[int]] = collections.defaultdict(set)
    kills: list[Kill] = []
    open_kills: list[Kill] = []
    by_mob: dict[int, Kill] = {}
    totals: collections.Counter = collections.Counter()
    party: collections.Counter = collections.Counter()  # `06 38` ids: you and your party
    loot: dict[int, tuple[int, str]] = {}

    def on(ts: float, pkt: bytes) -> None:
        op = P.opcode(pkt)
        totals[op] += 1
        for k in list(open_kills):
            if ts - k.ts > window:
                open_kills.remove(k)
            else:
                k.after.append((ts, pkt))
        if s := P.parse_spawn(pkt):
            mob_code[s.entity_id] = s.mob_code
            attackers.pop(s.entity_id, None)
        for h in P.parse_hits(pkt):
            attackers[h.target_id].add(h.actor_id)
        for mob, owner, name in loot_owner_records(pkt):
            loot.setdefault(mob, (owner, name))
        if ps := P.parse_party_scope(pkt):
            party[ps.entity_id] += 1
        if (d := P.parse_death(pkt)) and d.flag == P.DEATH_FLAG_COMBAT and d.entity_id in mob_code:
            k = Kill(ts, d.entity_id, mob_code[d.entity_id], set(attackers.get(d.entity_id, ())))
            kills.append(k)
            open_kills.append(k)
            by_mob[d.entity_id] = k

    capture.replay(path, capture.GameStream(on))
    for k in kills:  # the loot record can land just before or after the death
        k.loot_owner = loot.get(k.mob_id)
    return kills, totals, party


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pcap")
    ap.add_argument("--window", type=float, default=3.0, help="seconds after a death to look at")
    ap.add_argument("--npcs", default=str(NPCS_DEFAULT))
    ap.add_argument("--me", type=int, help="your character's entity id (default: guessed)")
    ap.add_argument("--dump", help="opcode like '1c,92': print those packets after each of your kills")
    a = ap.parse_args()
    npcs = json.loads(Path(a.npcs).read_text(encoding="utf-8"))
    name_of = lambda code: npcs.get(str(code), {}).get("name", f"#{code}")  # noqa: E731

    kills, totals, party = run(a.pcap, a.window)
    owners = collections.Counter(k.loot_owner for k in kills if k.loot_owner)
    print(f"{len(kills)} combat deaths of spawned mobs; loot owners seen: {owners.most_common(5)}")
    if not owners:
        print("No loot-owner record found: cannot tell your kills apart. Showing all deaths as one group.")
    owner_ids = {o[0]: o for o in owners}
    # You are the loot owner the party-scope records talk about most.
    guess = a.me or next((i for i, _ in party.most_common() if i in owner_ids), None)
    me = owner_ids.get(guess) if guess else None
    mine = [k for k in kills if me is None or k.loot_owner == me]
    others = [k for k in kills if me is not None and k.loot_owner != me]
    print(f"you = {me}; your kills: {len(mine)}, other deaths: {len(others)}\n")

    per_mob = collections.Counter(name_of(k.mob_code) for k in mine)
    print("your kills by monster:", per_mob.most_common())

    def presence(group):
        c = collections.Counter()
        for k in group:
            c.update({P.opcode(p) for _, p in k.after})
        return c

    pm, po = presence(mine), presence(others)
    print(f"\n{'opcode':8} {'after your kills':>17} {'after others':>13} {'total in capture':>17}")
    rows = sorted(pm, key=lambda o: (-pm[o] / max(len(mine), 1), o or (0, 0)))
    for op in rows:
        frac_m = pm[op] / max(len(mine), 1)
        frac_o = po[op] / max(len(others), 1) if others else 0
        tag = ""
        if 0 < frac_m < 0.95 and frac_o < 0.1 and totals[op] <= 3 * pm[op]:
            tag = "  <- candidate: follows SOME of your kills, rarely anything else"
        elif frac_m >= 0.95 and frac_o < 0.1:
            tag = "  <- every one of your kills (loot/exp/kill credit?)"
        hx = op and f"{op[0]:02x} {op[1]:02x}"
        print(f"{hx!s:8} {pm[op]:>6}/{len(mine):<10} {po[op]:>5}/{len(others):<7} {totals[op]:>10}{tag}")

    # Tighter: packets after your kill that carry the dead monster's type code (u24/u32 LE or
    # varint). A soul message most likely names the monster/pet it is for.
    print("\npackets after your kills that contain the monster's type code:")
    code_hits: collections.Counter = collections.Counter()
    examples: dict = {}
    for k in mine:
        if not k.mob_code:
            continue
        needles = {k.mob_code.to_bytes(3, "little"), _varint(k.mob_code)}
        seen = set()
        for ts, p in k.after:
            body = p[P.read_varint(p, 0)[1] + 2 :]
            if any(n in body for n in needles) and P.opcode(p) not in (P.OP_SPAWN,):
                seen.add(P.opcode(p))
                examples.setdefault(P.opcode(p), (k, ts, p))
        code_hits.update(seen)
    for op, n in code_hits.most_common():
        k, ts, p = examples[op]
        print(f"  {op[0]:02x} {op[1]:02x}  after {n}/{len(mine)} of your kills"
              f"   e.g. {name_of(k.mob_code)} +{ts - k.ts:.2f}s: {p[:48].hex(' ')}")

    if a.dump:
        want = tuple(int(x, 16) for x in a.dump.split(","))
        for k in mine:
            for ts, p in k.after:
                if P.opcode(p) == want:
                    print(f"\n{name_of(k.mob_code)} (mob {k.mob_id}, code {k.mob_code}) +{ts - k.ts:.2f}s:")
                    print("  " + p.hex(" "))


def _varint(v: int) -> bytes:
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        out.append(b | (0x80 if v else 0))
        if not v:
            return bytes(out)


if __name__ == "__main__":
    main()
