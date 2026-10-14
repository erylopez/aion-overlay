"""Aion 2 server->client stream: framing and the few records the pet tracker needs.

Layouts were learned from the community DPS meters (taengu/A2Tools-DPS-Meter, current as of
the June 2026 opcode shift). Everything here is written fresh; only the byte layouts are shared.

Stream:  <varint len> <body>      total frame size = len - 4 + varint_bytes
Bundle:  <varint len> FF FF <u32 LE decompressed size> <LZ4 block>   -> more frames inside
Opcode:  the two bytes right after the length varint, e.g. `42 36`.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

import lz4.block

MAX_PACKET_BYTES = 65535
MAX_FRAGMENT_WAIT_BYTES = 16384
MAX_DECOMPRESSED_BYTES = 1_000_000
MAX_BUNDLE_DEPTH = 4

OP_SPAWN = (0x41, 0x36)  # mob / summon spawn (was 40 36 before 2026-06)
OP_DEATH = (0x42, 0x36)  # death / despawn (was 41 36 before 2026-06)
OP_DAMAGE = (0x04, 0x38)
OP_PARTY_SCOPE = (0x06, 0x38)  # only ever about you and your party
DEATH_FLAG_COMBAT = 3

# The game stream carries this terminator ~19x/s even idle; used to find the game flow.
GAME_SIGNATURES = (b"\x0e\x00\x36", b"\x06\x00\x36")


def read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    """(value, byte length); length 0 means no valid varint at `pos`."""
    value = shift = count = 0
    while True:
        if pos + count >= len(buf):
            return 0, 0
        b = buf[pos + count]
        count += 1
        value |= (b & 0x7F) << shift
        if not b & 0x80:
            return value, count
        shift += 7
        if shift >= 32:
            return 0, 0


def frame_size(value: int, varint_len: int) -> int | None:
    size = value - 4 + varint_len
    return size if size >= varint_len and size > 0 else None


def _is_tls_record(b: bytes, at: int) -> int | None:
    if len(b) - at < 5 or not 0x14 <= b[at] <= 0x17 or b[at + 1] != 0x03 or not 1 <= b[at + 2] <= 4:
        return None
    n = int.from_bytes(b[at + 3 : at + 5], "big")
    return 5 + n if 0 < n <= 16384 + 256 else None


def walk(buf: bytes, *, inner: bool = False) -> tuple[list[tuple[int, int]], int]:
    """Split `buf` into (start, end) frames. Returns the frames and how many bytes were consumed;
    the rest is a frame still arriving. `inner` is the stricter walk used inside a bundle."""
    frames: list[tuple[int, int]] = []
    off = 0
    while off < len(buf):
        if buf[off] == 0:
            off += 1
            continue
        if not inner and (tls := _is_tls_record(buf, off)):
            if off + tls > len(buf):
                break
            off += tls
            continue
        value, vlen = read_varint(buf, off)
        if vlen == 0 or value <= 0:
            if inner:
                break
            if off + 5 > len(buf):
                break
            off += 1
            continue
        total = frame_size(value, vlen)
        if total is None or (not inner and total > MAX_PACKET_BYTES):
            off += 1
            continue
        if off + total > len(buf):
            if not inner and total > MAX_FRAGMENT_WAIT_BYTES:
                off += 1
                continue
            break
        frames.append((off, off + total))
        off += total
    return frames, off


def decompress_bundle(payload: bytes) -> bytes | None:
    """`payload` starts at the FF FF marker."""
    if len(payload) < 7:
        return None
    size = int.from_bytes(payload[2:6], "little")
    if size == 0 or size > MAX_DECOMPRESSED_BYTES:
        return None
    try:
        return lz4.block.decompress(payload[6:], uncompressed_size=size)
    except lz4.block.LZ4BlockError:
        return None


def split(buf: bytes, depth: int = 0, *, inner: bool = False) -> tuple[list[bytes], int]:
    """Every leaf packet in `buf`, bundles opened, and how many bytes of `buf` were consumed."""
    out: list[bytes] = []
    frames, consumed = walk(buf, inner=inner)
    for start, end in frames:
        pkt = buf[start:end]
        _, vlen = read_varint(pkt, 0)
        if len(pkt) > vlen + 1 and pkt[vlen] == 0xFF and pkt[vlen + 1] == 0xFF:
            if depth < MAX_BUNDLE_DEPTH and (data := decompress_bundle(pkt[vlen:])):
                out.extend(split(data, depth + 1, inner=True)[0])
        else:
            out.append(pkt)
    return out, consumed


def opcode(pkt: bytes) -> tuple[int, int] | None:
    _, vlen = read_varint(pkt, 0)
    if vlen == 0 or vlen + 2 > len(pkt):
        return None
    return pkt[vlen], pkt[vlen + 1]


# --- records ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Spawn:
    entity_id: int
    mob_code: int | None
    max_hp: int | None


@dataclass(frozen=True)
class Death:
    entity_id: int
    flag: int


@dataclass(frozen=True)
class Hit:
    target_id: int
    actor_id: int
    skill: int


@dataclass(frozen=True)
class PartyScope:
    entity_id: int


def parse_spawn(pkt: bytes) -> Spawn | None:
    """`41 36 <entity varint> <mask> ...`; the mob code is the u24 before an `00 (00|40) 02` marker
    within 60 bytes, and the HP follows as `01 <cur varint> <max varint>`."""
    _, vlen = read_varint(pkt, 0)
    if opcode(pkt) != OP_SPAWN:
        return None
    pos = vlen + 2
    eid, n = read_varint(pkt, pos)
    if n == 0:
        return None
    pos += n
    code = hp = None
    limit = min(len(pkt) - 2, pos + 60)
    for i in range(pos, limit):
        if pkt[i] == 0 and pkt[i + 1] in (0x00, 0x40) and pkt[i + 2] == 0x02:
            if i >= pos + 3:
                code = pkt[i - 3] | pkt[i - 2] << 8 | pkt[i - 1] << 16
                hp_end = min(len(pkt) - 2, i + 3 + 64)
                for j in range(i + 3, hp_end):
                    if pkt[j] != 0x01:
                        continue
                    cur, cn = read_varint(pkt, j + 1)
                    if cn and cur > 0:
                        mx, mn = read_varint(pkt, j + 1 + cn)
                        if mn and mx >= cur:
                            hp = mx
                            break
            break
    return Spawn(eid, code, hp)


def parse_death(pkt: bytes) -> Death | None:
    """`42 36 <entity varint> <varint, always 0> <flag varint>`; flag 3 = killed in combat."""
    if opcode(pkt) != OP_DEATH:
        return None
    _, vlen = read_varint(pkt, 0)
    pos = vlen + 2
    eid, n = read_varint(pkt, pos)
    if n == 0:
        return None
    pos += n
    _, n = read_varint(pkt, pos)
    if n == 0:
        return None
    flag, n = read_varint(pkt, pos + n)
    if n == 0:
        return None
    return Death(eid, flag)


def parse_hits(pkt: bytes) -> list[Hit]:
    """`04 38` then records `[01 00] <target> <switch> <flag> <actor> <skill u32> ...`. Only the first
    record's head is read: who hit whom is all the tracker needs, not the damage."""
    if opcode(pkt) != OP_DAMAGE:
        return []
    _, vlen = read_varint(pkt, 0)
    pos = vlen + 2
    if pkt[pos : pos + 2] == b"\x01\x00":
        pos += 2
    target, n = read_varint(pkt, pos)
    if not n:
        return []
    pos += n
    switch, n = read_varint(pkt, pos)
    if not n or (switch & 0x0F) not in (0, 2, 4, 5, 6, 7):
        return []
    pos += n
    _, n = read_varint(pkt, pos)
    if not n:
        return []
    pos += n
    actor, n = read_varint(pkt, pos)
    if not n or pos + n + 4 > len(pkt):
        return []
    pos += n
    skill = int.from_bytes(pkt[pos : pos + 4], "little")
    if not 1 <= skill <= 299_999_999 or 1_000_000 <= skill <= 9_999_999:
        return []  # 7-digit skills are NPC skills: a mob hitting someone
    return [Hit(target, actor, skill)]


def parse_party_scope(pkt: bytes) -> PartyScope | None:
    if opcode(pkt) != OP_PARTY_SCOPE:
        return None
    _, vlen = read_varint(pkt, 0)
    eid, n = read_varint(pkt, vlen + 2)
    return PartyScope(eid) if n else None


OP_SOUL = (0x0D, 0x90)  # sent only to you: a pet soul was gained


@dataclass(frozen=True)
class Soul:
    pet_id: int
    amount: int


def parse_soul(pkt: bytes) -> Soul | None:
    """`0d 90 01 <pet id u32 LE> <amount u32 LE>`. Identified 2026-10-09: one per soul, ~0.3 s after
    the kill, 5/5 against marked Meadow Sparkie souls (pet 1006); party kills earn them too."""
    if opcode(pkt) != OP_SOUL:
        return None
    _, vlen = read_varint(pkt, 0)
    b = pkt[vlen + 2 :]
    if len(b) < 9 or b[0] != 0x01:
        return None
    pet = int.from_bytes(b[1:5], "little")
    amount = int.from_bytes(b[5:9], "little")
    if not 0 < amount < 1000:
        return None
    return Soul(pet, amount)


OP_CRYSTAL = (0x11, 0x90)  # sent only to you: genus crystals, from a monster whose pet is maxed

# The genus byte of `11 90`, as seen. Natura and Varian have not been captured yet.
CRYSTAL_GENUS = {1: "fera", 2: "cogni"}


@dataclass(frozen=True)
class Crystal:
    genus: int
    amount: int
    raw: bytes  # the whole body, while the last byte is not understood


def parse_crystal(pkt: bytes) -> Crystal | None:
    """`11 90 01 <genus u8> <amount u32 LE> 02`. Identified 2026-10-10: one ~0.3 s after each kill
    of a monster whose pet is at Lv3, never in the captures with souls. lv3_crystals.pcap: 6 Fera
    kills (Cairn Tog, Splendent Hill Sparkie), genus 01, 1 crystal each in game; lv3_cogni.pcap: 3
    Cogni kills (Wandering Manduri Fighter), genus 02. The message does not name the pet: the kill
    just before it does. The trailing 02 was the same in both."""
    if opcode(pkt) != OP_CRYSTAL:
        return None
    _, vlen = read_varint(pkt, 0)
    b = pkt[vlen + 2 :]
    if len(b) < 6 or b[0] != 0x01:
        return None
    amount = int.from_bytes(b[2:6], "little")
    if not 0 < amount < 1000:
        return None
    return Crystal(b[1], amount, bytes(b))


OP_COLLECTION = (0x00, 0x90)  # your whole pet collection, sent once when you enter the world


@dataclass(frozen=True)
class Collection:
    levels: dict[int, int]  # pet id -> Insight level
    souls: dict[int, int]  # pet id -> souls, as the Pets menu shows them
    extra: bytes  # what follows the two lists: undecoded (genus data?)


def parse_collection(pkt: bytes) -> Collection | None:
    """`00 90 <u32> <varint n> n×(<pet id u32> <pet id u32> <level u32>) <varint m> m×(<pet id u32>
    <souls u32>) ...`. Identified 2026-10-09 from a login: Meadow Sparkie 32 and Hungry Brax 65
    matched the Pets menu. Levels do not follow from the souls alone (pets also come whole from
    chests and shops), so both lists are kept."""
    if opcode(pkt) != OP_COLLECTION:
        return None
    _, vlen = read_varint(pkt, 0)
    b = pkt[vlen + 2 :]
    pos = 4
    n, ln = read_varint(b, pos)
    if not ln or pos + ln + 12 * n > len(b):
        return None
    pos += ln
    levels = {}
    for _ in range(n):
        pid, pid2, level = (int.from_bytes(b[pos + k : pos + k + 4], "little") for k in (0, 4, 8))
        if pid != pid2:
            return None  # not the layout we know: better no sync than a wrong one
        levels[pid] = level
        pos += 12
    m, ln = read_varint(b, pos)
    if not ln or pos + ln + 8 * m > len(b):
        return None
    pos += ln
    souls = {}
    for _ in range(m):
        souls[int.from_bytes(b[pos : pos + 4], "little")] = int.from_bytes(b[pos + 4 : pos + 8], "little")
        pos += 8
    return Collection(levels, souls, b[pos:])


# --- where you are ----------------------------------------------------------------------------
#
# Positions are game coordinates; questlog.gg's map data (and the app) store y negated, so the
# sidecar reports (x, -y). Found 2026-10-09 in login and kill captures.

OP_MAP_LOAD = (0x21, 0x36)  # every zone load: the map id (= questlog.gg world id) and where you are
OP_TELEPORT = (0x23, 0x36)  # entity 0 = you, placed somewhere (zone entry, teleport)
OP_CASTS = ((0x02, 0x38), (0x03, 0x38))  # skill casts: the caster, then where it stands


@dataclass(frozen=True)
class MapLoad:
    world: int
    x: float
    y: float


def _f32(b: bytes, at: int) -> float:
    return struct.unpack_from("<f", b, at)[0]


def _body(pkt: bytes) -> bytes:
    _, vlen = read_varint(pkt, 0)
    return pkt[vlen + 2 :]


def parse_map_load(pkt: bytes) -> MapLoad | None:
    """`21 36 <u32> <u32 map id> <8 bytes> <f32 x> <f32 y> <f32 z> ...`"""
    if opcode(pkt) != OP_MAP_LOAD:
        return None
    b = _body(pkt)
    if len(b) < 28:
        return None
    return MapLoad(int.from_bytes(b[4:8], "little"), _f32(b, 16), _f32(b, 20))


def parse_self_teleport(pkt: bytes) -> tuple[float, float] | None:
    """`23 36 00 <5 bytes> <f32 x> <f32 y> <f32 z>`: entity 0 is the local player."""
    if opcode(pkt) != OP_TELEPORT:
        return None
    b = _body(pkt)
    if len(b) < 18 or b[0] != 0:
        return None
    return _f32(b, 6), _f32(b, 10)


def parse_cast(pkt: bytes) -> tuple[int, float, float] | None:
    """`02 38` / `03 38 <caster varint> 00 <target varint> <skill u32> ... <f32 x> <f32 y>`: the
    caster's position. Its offset moves with the varints, so the first plausible pair after the
    skill is taken: game coordinates stay within +-500,000, and values under 1,000 are the other
    fields of the record read as floats (a 0x42ED90C1 there reads as 118.7)."""
    if opcode(pkt) not in OP_CASTS:
        return None
    b = _body(pkt)
    actor, n = read_varint(b, 0)
    if not n:
        return None
    for off in range(n + 6, min(len(b) - 8, n + 24)):
        x, y = _f32(b, off), _f32(b, off + 4)
        if 1000 < abs(x) < 500_000 and 1000 < abs(y) < 500_000:
            return actor, x, y
    return None


OP_SELF = (0x33, 0x36)  # you, on every zone entry: entity, name and server among much else


@dataclass(frozen=True)
class Character:
    name: str
    server: int


def _name(b: bytes, pos: int) -> str | None:
    """A length-prefixed character name at `pos`: 1-32 bytes of UTF-8 letters and digits."""
    n = b[pos] if pos < len(b) else 0
    if not 1 <= n <= 32 or pos + 1 + n > len(b):
        return None
    try:
        name = b[pos + 1 : pos + 1 + n].decode("utf-8")
    except UnicodeDecodeError:
        return None
    return name if name.isalnum() else None


def parse_character(pkt: bytes) -> Character | None:
    """Which character you are: `33 36 <entity varint> <5 bytes> <len u8> <name> <server u16 LE>
    ...` (~2.2 KB), once at every zone entry, logins included (right after the collection, `00 90`).
    Identified 2026-10-13 in login1, chat_login and zones1. Its name is the first length-prefixed
    one within a few bytes of the entity.

    Not `39 8a <len> <name>`: it named you at login, but gartua.pcap has six of them naming other
    players around (online notices?), and 0.1.25 switched collections on them."""
    if opcode(pkt) != OP_SELF:
        return None
    _, vlen = read_varint(pkt, 0)
    b = pkt[vlen + 2 :]
    _, pos = read_varint(b, 0)
    for p in range(pos, min(pos + 12, len(b))):
        if (name := _name(b, p)) is not None:
            end = p + 1 + len(name.encode())
            return Character(name, int.from_bytes(b[end : end + 2], "little")) if end + 2 <= len(b) else None
    return None


OP_ITEM = (0x1B, 0x56)  # an inventory stack's new count; Kina is one of them
KINA_ITEM = bytes.fromhex("3f337037")


def parse_kina(pkt: bytes) -> int | None:
    """Your Kina balance, from the `1b 56` record of its stack:
    `1b 56 01 01 00 <u32> <u32> 3f 33 70 37 <balance u64 LE> ...` (44 bytes with the length).
    Identified 2026-10-13 in kills1, sparkie_long, lv3_crystals and lv3_cogni: one after each kill
    that dropped Kina, the balance only ever going up between them (+161 to +362 at Lv13 Cairn Togs).
    The same opcode carries other stacks (crystals, materials) with other item bytes."""
    if opcode(pkt) != OP_ITEM:
        return None
    _, vlen = read_varint(pkt, 0)
    b = pkt[vlen + 2 :]
    if len(b) < 23 or b[0] != 0x01 or b[11:15] != KINA_ITEM:
        return None
    return int.from_bytes(b[15:23], "little")


OP_FIELD_BOSSES = (0x01, 0x91)  # the map's field boss list for your zone, every ~3 s while the map is open


@dataclass(frozen=True)
class FieldBoss:
    id: int  # the list's own id: 101001-101024 in Verteron (zone 1010 * 100 + n)
    up: bool
    at_ms: int  # up: when it spawned; dead: when it respawns
    position: tuple[float, float, float] | None  # where it is, while up


@dataclass(frozen=True)
class FieldBosses:
    world: int
    bosses: list[FieldBoss]


def parse_field_bosses(pkt: bytes) -> FieldBosses | None:
    """`01 91 <u16> <world u32> <count u8>` then per boss: up `01 <id varint> <x y z f32> [1 byte]
    <spawned u64 ms>`, dead `00 <id varint> <respawns u64 ms>`. Identified 2026-10-13 (gartua.pcap,
    fieldboss_list.pcap): sent every ~3 s while the map is open, never with it closed. Eternal
    Gartua (101021) turned up 0.5 s after its spawn and dead 0.5 s after its death, its respawn
    then 12 h on; the dead bosses' times matched the in-game list to the second, and each up boss's
    position is its questlog.gg marker's (y negated). Some entries, up or dead, carry a byte more
    before the time (unknown), so the time is found where an ms timestamp fits."""
    if opcode(pkt) != OP_FIELD_BOSSES:
        return None
    _, vlen = read_varint(pkt, 0)
    b = pkt[vlen + 2 :]
    if len(b) < 7:
        return None
    world, n = int.from_bytes(b[2:6], "little"), b[6]
    pos, out = 7, []
    for _ in range(n):
        if pos >= len(b) or b[pos] not in (0, 1):
            return None
        up = b[pos] == 1
        bid, ln = read_varint(b, pos + 1)
        if not ln:
            return None
        pos += 1 + ln
        xyz = None
        if up:
            if pos + 12 > len(b):
                return None
            xyz = struct.unpack_from("<3f", b, pos)
            pos += 12
        # Then the time, sometimes after a byte or so more (unknown): where an ms timestamp fits.
        for k in range(5):
            if pos + k + 8 <= len(b) and _plausible_ms(b, pos + k):
                pos += k
                break
        else:
            return None
        out.append(FieldBoss(bid, up, int.from_bytes(b[pos : pos + 8], "little"), xyz))
        pos += 8
    return FieldBosses(world, out)


def _plausible_ms(b: bytes, pos: int) -> bool:
    """A u64 at `pos` that reads as a time in ms since 1970, in this game's lifetime."""
    return 1_600_000_000_000 < int.from_bytes(b[pos : pos + 8], "little") < 2_200_000_000_000


OP_SHOP = (0x91, 0x56)  # the Black Cloud Merchant's stock for one tab, sent when the tab is opened
SHOP_RECORD = 34


@dataclass(frozen=True)
class ShopItem:
    slot: int  # the shop's own product id
    item: int  # the game's item id (questlog.gg's): "Pet: <name>" items grant a pet
    quantity: int
    currency: int
    base: int  # the price before the discount
    price: int


@dataclass(frozen=True)
class Shop:
    tab: int
    items: list[ShopItem]
    next_at_ms: int | None  # when the stock changes next (ms since epoch, UTC)


def _shop_record(b: bytes, o: int) -> ShopItem | None:
    if o + SHOP_RECORD > len(b):
        return None
    slot, item = struct.unpack_from("<II", b, o)
    quantity = struct.unpack_from("<Q", b, o + 8)[0]
    currency = b[o + 17]
    base, price = struct.unpack_from("<QQ", b, o + 18)
    if not (0 < slot < 1 << 24 and 100_000_000 <= item < 1 << 32 and 0 < quantity < 1_000_000
            and 0 < price <= base < 10**12):
        return None
    return ShopItem(slot, item, quantity, currency, base, price)


def parse_shop(pkt: bytes) -> Shop | None:
    """`91 56 <tab u8> <count u8>` then per item `<slot u32> <item u32> <quantity u64> <discount
    tier u8> <currency u8> <base price u64> <price u64>`, then `<next restock u64 ms>`. Found
    2026-10-12 (captures/shop_open.pcap): sent when a Black Cloud Merchant tab is opened, one per
    tab; the ten Pets-tab records matched the screen (items, discounts, both prices) and the
    trailing time was the next hour, when the stock changes. Some records start one byte later
    (an extra 0x55 or 0x05 before them, not decoded), so each is tried where expected and one byte
    on. The discount tier byte (00 = 10%, 01 = 20%, 03 = 50%) is not kept: the prices say it."""
    if opcode(pkt) != OP_SHOP:
        return None
    _, vlen = read_varint(pkt, 0)
    b = pkt[vlen + 2 :]
    if len(b) < 2:
        return None
    tab, count, o = b[0], b[1], 2
    items = []
    for _ in range(count):
        for start in (o, o + 1):
            if rec := _shop_record(b, start):
                items.append(rec)
                o = start + SHOP_RECORD
                break
        else:
            return None
    next_at = struct.unpack_from("<Q", b, o)[0] if o + 8 <= len(b) else None
    return Shop(tab, items, next_at if next_at and 1.5e12 < next_at < 4e12 else None)
