"""Live pet-soul tracker.

    python -m aion2_tracker.track                 watch the game and count souls (Ctrl+C to stop)
    python -m aion2_tracker.track --replay X.pcap count the souls in a saved capture
    python -m aion2_tracker.track set 1006 18     set a pet's count to what the Pets menu shows
    python -m aion2_tracker.track show            print the saved collection
    python -m aion2_tracker.track sync X.pcap     take every pet's count from a capture of a login

A soul is the `0d 90` record (pet id + amount), which the server sends only to you. The record does
not name the monster, so each pet's name is learned from the kills just before its souls arrive,
by majority vote, and settles after a few souls.
"""

from __future__ import annotations

import argparse
import collections
import copy
import json
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path

from . import capture, protocol as P
from .analyze import NPCS_DEFAULT, load_droppers, load_genera, loot_owner_records

STORE = Path(__file__).resolve().parents[1] / "collection.json"
# Souls to go from Lv0 to 1, 1 to 2 and 2 to 3. The count the Pets menu shows restarts at 0 on each
# level-up, and a pet at MAX_LEVEL collects genus crystals instead of souls (the user, and the login
# collection: Lv0 pets hold 1-4 souls, Lv1 0-24, Lv2 0-74, Lv3 always 0).
LEVEL_NEED = (5, 25, 75)
MAX_LEVEL = 3
NAME_WINDOW_S = 1.5
# A "combat" event at most this often: the overlay only needs to know fighting is going on.
COMBAT_EVERY_S = 5.0
# How soon after a login sync the record naming the character comes (same frame bundle in the
# captures): a switch of character within this moves the sync to the new one.
SYNC_SWITCH_S = 30.0


def load(path: Path = STORE) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"pets": {}}


def save(data: dict, path: Path = STORE) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def pet_name(pet: dict) -> str:
    votes = pet.get("votes", {})
    return max(votes, key=votes.get) if votes else "(unknown monster)"


def progress(pet: dict) -> str:
    level = pet.get("level") or 0
    est = " (est.)" if pet.get("level") is None or pet.get("levelEstimated") else ""
    if level >= MAX_LEVEL:
        return f"  Lv{level} max, {pet.get('crystals', 0)} crystals{est}"
    return f"{pet['souls']:>3}/{LEVEL_NEED[level]} souls  Lv{level}{est}"


def level_up(pet: dict) -> bool:
    """Apply the level rules to a pet's souls: past a threshold the pet levels up and the count
    restarts. True if it levelled. A pet whose level was never sent by the server starts at 0."""
    level = pet.get("level")
    if level is None:
        level = 0
        pet["levelEstimated"] = True
    levelled = False
    while level < MAX_LEVEL and pet["souls"] >= LEVEL_NEED[level]:
        pet["souls"] -= LEVEL_NEED[level]
        level += 1
        levelled = True
    pet["level"] = level
    return levelled


def pet_view(pid: str | int, pet: dict, session: int = 0) -> dict:
    """One pet as the overlay sees it."""
    votes = pet.get("votes", {})
    level = pet.get("level")
    return {
        "id": int(pid),
        "name": max(votes, key=votes.get) if votes else None,
        "souls": pet["souls"],
        "level": level if level is not None else 0,
        "levelEstimated": level is None or bool(pet.get("levelEstimated")),
        "crystals": pet.get("crystals", 0),
        "session": session,
    }


def print_event(ev: dict) -> None:
    """The console's view of the tracker's events."""
    stamp = time.strftime("%H:%M:%S", time.localtime(ev.get("ts", time.time())))
    if ev["type"] == "sync":
        print(f"{stamp}  synced {ev['pets']} pets from the server ({ev['souls']} souls in all)")
        for c in ev["corrected"]:
            print(f"          corrected {c['name'] or '(unknown monster)'} (pet {c['id']}) {c['before']} -> {c['after']}")
    elif ev["type"] == "soul":
        pet = ev["pet"]
        lv = f"Lv{pet['level']}" + (" (est.)" if pet["levelEstimated"] else "")
        print(f"{stamp}  +{ev['amount']} soul  {pet['name'] or '(unknown monster)':30} pet {pet['id']:<6} "
              f"{pet['souls']:>3} souls  {lv}   (this session: {pet['session']})")
    elif ev["type"] == "crystal":
        pet = ev["pet"]
        who = f"{pet['name'] or '(unknown monster)':30} pet {pet['id']:<6} {pet['crystals']:>3} crystals" if pet else             f"(monster {ev['npc'] or 'unknown'})"
        print(f"{stamp}  +{ev['amount']} {ev['genus'] or '?'} crystal  {who}   [{ev['raw']}]")


class Tracker:
    def __init__(self, data: dict, npcs: dict, persist: bool = True,
                 on_event: Callable[[dict], None] = print_event, store: Path = STORE,
                 droppers: dict[int, int] | None = None, genera: dict[int, str] | None = None):
        self.data, self.npcs, self.persist, self.on_event, self.store = data, npcs, persist, on_event, store
        # Monster code -> the pet it drops: how a crystal, which names no pet, finds one.
        self.droppers = load_droppers() if droppers is None else droppers
        # Pet -> genus: a crystal's genus must match its pet's.
        self.genera = load_genera() if genera is None else genera
        self.mob_code: dict[int, int | None] = {}
        self.recent: collections.deque = collections.deque(maxlen=64)  # (ts, mob entity)
        # Each character's session counts; `session` is the one playing.
        self.sessions: dict[str | None, collections.Counter] = {}
        self.session: collections.Counter = self.sessions.setdefault(self.data.get("current"), collections.Counter())
        # The capture thread and the overlay's edits both change `data`.
        self.lock = threading.RLock()
        # Around you: the monsters loaded in your view (entity -> mob code), your zone and your
        # position (x, -y: questlog.gg's convention, as the app's map data uses).
        self.visible: dict[int, int] = {}
        self.world: int | None = None
        self.position: tuple[float, float] | None = None
        self.nearby_dirty = False
        # Collections saved before the level rules can hold a pet past its threshold (97 souls at
        # Lv1): level those up now, as the game already has.
        for pid, pet in self.data["pets"].items():
            if pet.get("level") is not None and level_up(pet):
                print(f"level: pet {pid} was past its threshold, now Lv{pet['level']} with {pet['souls']}", file=sys.stderr)
        # Which entity is you: the player credited with the kills just before your souls.
        self.credits: collections.deque = collections.deque(maxlen=32)  # (ts, mob, player entity)
        self.last_combat = float("-inf")
        # The collection as it was before the last login sync, and that sync: the sync comes just
        # before the record that says who you are, so a switch of character moves it across.
        self.before_sync: tuple[float, dict, P.Collection] | None = None
        # The map's field boss list, as last passed on: it comes every 3 s, unchanged mostly.
        self.field_bosses: tuple | None = None
        self.self_votes: collections.Counter = collections.Counter()

    def on_packet(self, ts: float, pkt: bytes) -> None:
        # Under the lock: the app's helper reads `visible` from another thread.
        with self.lock:
            self._on_packet(ts, pkt)

    def _on_packet(self, ts: float, pkt: bytes) -> None:
        if s := P.parse_spawn(pkt):
            self.mob_code[s.entity_id] = s.mob_code
            if s.mob_code:
                self.visible[s.entity_id] = s.mob_code
                self.nearby_dirty = True
        for mob, owner, _name in loot_owner_records(pkt):
            if mob in self.mob_code:
                self.recent.append((ts, mob))
                self.credits.append((ts, mob, owner))
            # Your kills (anyone's until it is known which player you are): fighting is going on.
            me = self.self_id()
            if (me is None or owner == me) and ts - self.last_combat >= COMBAT_EVERY_S:
                self.last_combat = ts
                self.on_event({"type": "combat", "ts": ts})
        if d := P.parse_death(pkt):
            # Any 42 36 takes a monster out of view: 1 = out of range, 3 = killed, 7 = gone.
            if self.visible.pop(d.entity_id, None) is not None:
                self.nearby_dirty = True
            if d.flag == P.DEATH_FLAG_COMBAT and d.entity_id in self.mob_code:
                self.recent.append((ts, d.entity_id))
        if m := P.parse_map_load(pkt):
            # A new zone: nothing from the last one is around you any more.
            self.world, self.position = m.world, (m.x, -m.y)
            self.visible.clear()
            self.nearby_dirty = True
        elif t := P.parse_self_teleport(pkt):
            self.position = (t[0], -t[1])
            self.nearby_dirty = True
        elif (c := P.parse_cast(pkt)) and c[0] == self.self_id():
            self.position = (c[1], -c[2])
            self.nearby_dirty = True
        if (who := P.parse_character(pkt)) is not None:
            self._character(ts, who)
        if soul := P.parse_soul(pkt):
            self._soul(ts, soul)
        elif crystal := P.parse_crystal(pkt):
            self._crystal(ts, crystal)
        elif (kina := P.parse_kina(pkt)) is not None:
            # The balance as is: the app works out what was earned (and per hour) from the changes.
            self.on_event({"type": "kina", "ts": ts, "balance": kina})
        elif bosses := P.parse_field_bosses(pkt):
            key = (bosses.world, tuple((b.id, b.up, b.at_ms) for b in bosses.bosses))
            if key != self.field_bosses:
                self.field_bosses = key
                self.on_event({"type": "fieldBosses", "ts": ts, "world": bosses.world,
                               "bosses": [{"id": b.id, "up": b.up, "at": b.at_ms} for b in bosses.bosses]})
        elif shop := P.parse_shop(pkt):
            # The Black Cloud Merchant's stock, as the tab just opened shows it: passed on as is
            # (the app knows which items are pets, and which pets are worth buying).
            self.on_event({"type": "shop", "ts": ts, "tab": shop.tab, "nextAt": shop.next_at_ms,
                           "items": [vars(i) for i in shop.items]})
        if coll := P.parse_collection(pkt):
            self._sync(ts, coll)

    def forget_view(self) -> None:
        """The game closed: nothing is around you any more, and entity ids start over."""
        with self.lock:
            self.visible.clear()
            self.mob_code.clear()
            self.credits.clear()
            self.self_votes.clear()
            self.world = self.position = None
            self.nearby_dirty = True

    def _maxed(self, pid: int | None) -> bool:
        """A pet at the cap, which gets crystals instead of souls."""
        pet = self.data["pets"].get(str(pid)) if pid is not None else None
        return bool(pet) and (pet.get("level") or 0) >= MAX_LEVEL

    def self_id(self) -> int | None:
        best = self.self_votes.most_common(1)
        return best[0][0] if best else None

    def nearby(self) -> dict:
        """The monsters loaded around you, by mob code, with your zone and position."""
        with self.lock:
            self.nearby_dirty = False
            counts = collections.Counter(self.visible.values())
        return {
            "world": self.world,
            "position": [round(v) for v in self.position] if self.position else None,
            "monsters": [{"npc": code, "count": n} for code, n in counts.most_common()],
        }

    def view(self, pid: str | int) -> dict:
        return pet_view(pid, self.data["pets"][str(pid)], self.session[int(pid)])

    def snapshot(self) -> list[dict]:
        with self.lock:
            return [self.view(pid) for pid in self.data["pets"]]

    def reset_session(self) -> None:
        """Start the session's counts again (the collection itself is untouched)."""
        with self.lock:
            self.session.clear()

    def set_souls(self, pid: int, souls: int) -> dict:
        with self.lock:
            self._pet(pid)["souls"] = souls
            self._save()
            return self.view(pid)

    def set_name(self, pid: int, name: str) -> dict:
        with self.lock:
            self._pet(pid)["votes"] = {name: 10**6}  # a name you give outvotes any learned one
            self._save()
            return self.view(pid)

    def _pet(self, pid: int) -> dict:
        return self.data["pets"].setdefault(str(pid), {"souls": 0, "votes": {}})

    def _save(self) -> None:
        if self.persist:
            save(self.data, self.store)

    def character(self) -> dict | None:
        """The character playing (the one the collection is), or None before one was seen."""
        name = self.data.get("current")
        return {"name": name, "server": self.data.get("characters", {}).get(name, {}).get("server")} if name else None

    def _character(self, ts: float, who: P.Character) -> None:
        """Pet levels are per character: each has its own collection (souls, levels, crystals),
        saved under `characters` while another plays. What the tracker learned of which monster
        drops which pet (the votes) is the same for all, and goes along to the one switched to."""
        chars = self.data.setdefault("characters", {})
        old = self.data.get("current")
        if who.name == old:
            if who.server is not None and chars.get(old, {}).get("server") != who.server:
                chars.setdefault(old, {})["server"] = who.server
                self._save()
            return
        resync = None
        if old is not None:
            # A login sync just before this was the new character's, not the old one's: undo it.
            if self.before_sync and ts - self.before_sync[0] <= SYNC_SWITCH_S:
                _, before, resync = self.before_sync
                self.data["pets"] = before
            chars.setdefault(old, {})["pets"] = self.data["pets"]
            entry = chars.setdefault(who.name, {})
            pets = entry.pop("pets", {})
            _merge_votes(self.data["pets"], pets)
            self.data["pets"] = pets
        # else: the first character seen takes the collection saved before characters were told apart
        # (a sync just before is this character's own, already in it).
        entry = chars.setdefault(who.name, {})
        if who.server is not None:
            entry["server"] = who.server
        self.data["current"] = who.name
        self.session = self.sessions.setdefault(who.name, collections.Counter())
        self._save()
        print(f"character: {who.name}" + (f" (was {old})" if old else ""), file=sys.stderr)
        self.before_sync = None
        if resync:
            self._sync(ts, resync, keep=False)
        self.on_event({"type": "character", "ts": ts, **self.character(), "switched": old is not None,
                       "pets": [self.view(pid) for pid in self.data["pets"]]})

    def _sync(self, ts: float, coll: P.Collection, keep: bool = True) -> None:
        """Entering the world sends the whole collection: take the server's numbers for every pet."""
        if keep:
            self.before_sync = (ts, copy.deepcopy(self.data["pets"]), coll)
        corrected = []
        for pid in coll.souls.keys() | coll.levels.keys():
            pet = self._pet(pid)
            souls = coll.souls.get(pid, 0)
            if pet["souls"] != souls and (pet["souls"] or pet.get("votes")):
                corrected.append({"id": pid, "name": pet_view(pid, pet)["name"], "before": pet["souls"], "after": souls})
            pet["souls"] = souls
            if pid in coll.levels:
                pet["level"] = coll.levels[pid]
                pet.pop("levelEstimated", None)
        self._save()
        self.on_event({"type": "sync", "ts": ts, "pets": len(coll.souls), "souls": sum(coll.souls.values()),
                       "corrected": corrected})

    def _soul(self, ts: float, soul: P.Soul) -> None:
        pet = self._pet(soul.pet_id)
        pet["souls"] += soul.amount
        levelled = level_up(pet)
        # Vote for the nearest kill before the soul (kill credit comes ~0.3 s before it).
        near = [(ts - t, m) for t, m in self.recent if 0 <= ts - t <= NAME_WINDOW_S]
        if near:
            code = self.mob_code.get(min(near)[1])
            name = self.npcs.get(str(code), {}).get("name")
            if name:
                pet["votes"][name] = pet["votes"].get(name, 0) + 1
        self.session[soul.pet_id] += soul.amount
        # Whoever was credited with the kill just before this soul is (most often) you.
        credited = [(ts - t, owner) for t, _mob, owner in self.credits if 0 <= ts - t <= NAME_WINDOW_S]
        if credited:
            self.self_votes[min(credited)[1]] += 1
        self._save()
        self.on_event({"type": "soul", "ts": ts, "amount": soul.amount, "pet": self.view(soul.pet_id),
                       "levelUp": levelled})

    def _crystal(self, ts: float, crystal: P.Crystal) -> None:
        """Genus crystals from a monster whose pet is maxed. The message names no pet, so it is
        the pet of a monster killed just before (yours if it is known which player you are), of
        the crystal's genus. Among those:
        - a pet already at Lv3 (as the login sync said) is it: the nearest such kill;
        - else, if they are all one pet's monsters, that pet is at Lv3 already in game, whatever
          was saved (souls it got and the tracker missed): it is corrected and credited
          (2026-10-11: Dracuni Herbalist, Lv3 in game, saved as Lv2 with 70);
        - else no one: two pets that could both be it (2026-10-10, a Foul Skama and a Marsh
          Targon dying together, had put the Skama's crystal on the Targon and marked it Lv3).
        """
        genus = P.CRYSTAL_GENUS.get(crystal.genus)
        credited = [(ts - t, mob, owner) for t, mob, owner in self.credits if 0 <= ts - t <= NAME_WINDOW_S]
        me = self.self_id()
        kills = [c for c in credited if c[2] == me] or credited
        # (seconds before, monster code, pet) for each kill whose monster drops a pet of this genus.
        candidates = []
        for ago, mob, _owner in kills:
            code = self.mob_code.get(mob)
            pid = self.droppers.get(code) if code else None
            if pid is not None and (genus is None or self.genera.get(pid) in (None, genus)):
                candidates.append((ago, code, pid))
        maxed = [c for c in candidates if self._maxed(c[2])]
        pick, corrected = None, False
        if maxed:
            pick = min(maxed)
        elif candidates and len({c[2] for c in candidates}) == 1:
            pick, corrected = min(candidates), True
        event = {"type": "crystal", "ts": ts, "amount": crystal.amount, "genus": genus,
                 "npc": pick[1] if pick else None, "raw": crystal.raw.hex(" "), "pet": None,
                 "levelCorrected": False,
                 # What was considered, when it went to no one: to see why in the log.
                 "kills": [] if pick else [
                     {"npc": self.mob_code.get(mob), "name": self._npc_name(self.mob_code.get(mob)),
                      "pet": self.droppers.get(self.mob_code.get(mob)), "ago": round(ago, 2)}
                     for ago, mob, _owner in kills]}
        if pick:
            _ago, code, pid = pick
            pet = self._pet(pid)
            if corrected:
                pet["level"], pet["souls"] = MAX_LEVEL, 0
                pet.pop("levelEstimated", None)
                event["levelCorrected"] = True
            pet["crystals"] = pet.get("crystals", 0) + crystal.amount
            if name := self._npc_name(code):
                pet["votes"][name] = pet["votes"].get(name, 0) + 1
            self._save()
            event["pet"] = self.view(pid)
        self.on_event(event)

    def _npc_name(self, code: int | None) -> str | None:
        return self.npcs.get(str(code), {}).get("name") if code else None

def _merge_votes(src: dict, dst: dict) -> None:
    """The monster names learned for each pet, from one character's collection into another's."""
    for pid, pet in src.items():
        if not pet.get("votes"):
            continue
        votes = dst.setdefault(pid, {"souls": 0, "votes": {}}).setdefault("votes", {})
        for name, n in pet["votes"].items():
            votes[name] = max(votes.get(name, 0), n)


def show(data: dict, everything: bool = True) -> None:
    pets = sorted(data["pets"].items(), key=lambda kv: -kv[1]["souls"])
    if not pets:
        print("no pets tracked yet")
    shown = [(pid, pet) for pid, pet in pets if everything or pet.get("votes")]
    for pid, pet in shown:
        print(f"  {pet_name(pet):30} pet {pid:<6} {progress(pet)}")
    if len(shown) < len(pets):
        print(f"  ... and {len(pets) - len(shown)} pets not yet matched to a monster ('show' lists all)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="*", help="'set <pet id> <souls>', 'name <pet id> <name>', 'sync <login.pcap>' or 'show'")
    ap.add_argument("--replay", help="count the souls in a saved .pcap instead of watching live")
    ap.add_argument("--npcs", default=str(NPCS_DEFAULT))
    a = ap.parse_args()
    data = load()

    if a.cmd:
        if a.cmd[0] == "set" and len(a.cmd) == 3:
            Tracker(data, npcs={}).set_souls(int(a.cmd[1]), int(a.cmd[2]))
        elif a.cmd[0] == "name" and len(a.cmd) >= 3:
            Tracker(data, npcs={}).set_name(int(a.cmd[1]), " ".join(a.cmd[2:]))
        elif a.cmd[0] == "sync" and len(a.cmd) == 2:
            # Only the login collection is taken from the capture, not its souls: a capture that is
            # synced twice must not count the same souls twice.
            tracker = Tracker(data, npcs={}, persist=True)

            def collection_only(ts: float, pkt: bytes) -> None:
                if coll := P.parse_collection(pkt):
                    tracker._sync(ts, coll)

            capture.replay(a.cmd[1], capture.GameStream(collection_only))
            show(data, everything=False)
            return
        elif a.cmd[0] != "show":
            ap.error("unknown command")
        show(data)
        return

    npcs = json.loads(Path(a.npcs).read_text(encoding="utf-8"))
    if a.replay:
        # A replay counts from zero into a throwaway copy, so it never touches your saved counts.
        tracker = Tracker({"pets": {}}, npcs, persist=False)
        capture.replay(a.replay, capture.GameStream(tracker.on_packet))
        show(tracker.data, everything=False)
        return
    tracker = Tracker(data, npcs)
    print("tracking pet souls. Log in (or switch character) while this runs to sync every pet.")
    show(data, everything=False)
    try:
        capture.live(capture.GameStream(tracker.on_packet))
    except KeyboardInterrupt:
        pass
    print("\nsession totals:")
    show(data, everything=False)


if __name__ == "__main__":
    main()
