//! The records the pet tracker and the overlay need, read from one game frame
//! (`<length varint> <opcode, 2 bytes> <body>`) as the parser's frame tap hands
//! it over. Ported from the Python tracker's `protocol.py` (Lokthar / Nyerk),
//! with the pet records fixed after A2Tools' pet-souls plugin: a soul pickup
//! lists every pet it gives souls to, and `14 90` says a pet levelled.

use a2tools_dps_meter_lib::capture::stream_processor::read_varint;

pub const OP_SPAWN: [u8; 2] = [0x41, 0x36];
pub const OP_DEATH: [u8; 2] = [0x42, 0x36];
pub const OP_SOUL: [u8; 2] = [0x0D, 0x90];
pub const OP_LEVEL_UP: [u8; 2] = [0x14, 0x90];
pub const OP_CRYSTAL: [u8; 2] = [0x11, 0x90];
pub const OP_COLLECTION: [u8; 2] = [0x00, 0x90];
pub const OP_MAP_LOAD: [u8; 2] = [0x21, 0x36];
pub const OP_TELEPORT: [u8; 2] = [0x23, 0x36];
pub const OP_CASTS: [[u8; 2]; 2] = [[0x02, 0x38], [0x03, 0x38]];
pub const OP_EFFECTS: [[u8; 2]; 2] = [[0x2A, 0x38], [0x2B, 0x38]];
pub const OP_SELF: [u8; 2] = [0x33, 0x36];
pub const OP_ITEM: [u8; 2] = [0x1B, 0x56];
pub const OP_FIELD_BOSSES: [u8; 2] = [0x01, 0x91];
pub const OP_SHOP: [u8; 2] = [0x91, 0x56];
pub const OP_KILL: [u8; 2] = [0x04, 0x8D];
pub const OP_PLAYER: [u8; 2] = [0x45, 0x36];
pub const OP_PLAYER_GONE: [u8; 2] = [0x47, 0x36];
pub const OP_LEGION: [u8; 2] = [0x33, 0x8A];
pub const OP_OBJECT_SPAWN: [u8; 2] = [0x34, 0x36];
pub const OP_OBJECT_REMOVED: [u8; 2] = [0x35, 0x36];
pub const OP_PLAYER_CARD: [u8; 2] = [0x30, 0x97];
pub const OP_TARGET_INFO: [u8; 2] = [0x50, 0x36];
pub const OP_PVP_SWITCH: [u8; 2] = [0x54, 0x36];
pub const OP_CHARACTER_LIST: [u8; 2] = [0x15, 0x36];
pub const OP_COUNTERS: [u8; 2] = [0x0B, 0x61];
pub const OP_COUNTER: [u8; 2] = [0x0C, 0x61];

/// `42 36`'s flag for a monster killed in combat (1: out of range, 7: gone).
pub const DEATH_FLAG_COMBAT: u32 = 3;
/// Pet ids are four digits (1001-1299 in the game's table): anything else in a
/// pet field is a misread, not a pet.
pub const PET_IDS: std::ops::RangeInclusive<u32> = 1000..=9999;
/// The most a pet's count can be (75 at Lv2): a count past it is a misread.
const MAX_SOULS: u32 = 1000;

/// `(value, bytes)`; `None` where no varint is.
fn varint(b: &[u8], at: usize) -> Option<(u32, usize)> {
    if at >= b.len() {
        return None;
    }
    let v = read_varint(b, at);
    (v.length > 0).then(|| (v.value as u32, v.length as usize))
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn u64_at(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

fn f32_at(b: &[u8], at: usize) -> Option<f32> {
    Some(f32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// The frame's opcode.
/// Where a frame's opcode starts: after its length prefix (the packet log).
pub fn opcode_at(frame: &[u8]) -> Option<usize> {
    varint(frame, 0).map(|(_, n)| n)
}

pub fn opcode(frame: &[u8]) -> Option<[u8; 2]> {
    let (_, n) = varint(frame, 0)?;
    frame.get(n..n + 2)?.try_into().ok()
}

/// The frame's body, if its opcode is `op`.
fn body(frame: &[u8], op: [u8; 2]) -> Option<&[u8]> {
    let (_, n) = varint(frame, 0)?;
    (frame.get(n..n + 2)? == op).then(|| &frame[n + 2..])
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Spawn {
    pub entity: u32,
    pub mob_code: Option<u32>,
}

/// `41 36 <entity varint> <mask> ...`: the mob code is the u24 before an
/// `00 (00|40) 02` marker within 60 bytes.
pub fn spawn(frame: &[u8]) -> Option<Spawn> {
    let b = body(frame, OP_SPAWN)?;
    let (entity, n) = varint(b, 0)?;
    let limit = (b.len().saturating_sub(2)).min(n + 60);
    let code = (n..limit)
        .find(|&i| b[i] == 0 && matches!(b[i + 1], 0x00 | 0x40) && b[i + 2] == 0x02)
        .filter(|&i| i >= n + 3)
        .map(|i| b[i - 3] as u32 | (b[i - 2] as u32) << 8 | (b[i - 1] as u32) << 16);
    Some(Spawn { entity, mob_code: code })
}

/// `42 36 <entity varint> <varint, always 0> <flag varint>`.
pub fn death(frame: &[u8]) -> Option<(u32, u32)> {
    let b = body(frame, OP_DEATH)?;
    let (entity, n) = varint(b, 0)?;
    let (_, m) = varint(b, n)?;
    let (flag, _) = varint(b, n + m)?;
    Some((entity, flag))
}

/// A kill credit: `04 8D <victim varint> <u32> <killer varint> <server u16>
/// <len><name> [<len><legion>] ... <last byte>`. Who got the killing blow on a
/// monster or player around you; the last byte is 01 when the victim was a
/// player. The same opcode links summons to their owners with no name: not a
/// credit. It is found anywhere in a frame, as it also comes embedded.
#[derive(Debug, Clone, PartialEq)]
pub struct KillCredit {
    pub victim: u32,
    pub killer: u32,
    pub server: u16,
    pub name: String,
    pub legion: Option<String>,
    pub player_victim: bool,
}

/// Every kill credit in `frame` (Python's `loot_owner_records`, plus the
/// legion and the player-victim byte from Nyerk 0.2.17's `parse_kill_credit`).
pub fn kill_credits(frame: &[u8]) -> Vec<KillCredit> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(at) = frame[i..].windows(2).position(|w| w == OP_KILL).map(|p| p + i) {
        i = at + 2;
        let Some(credit) = kill_credit_at(frame, i) else { continue };
        out.push(credit);
    }
    out
}

fn kill_credit_at(b: &[u8], at: usize) -> Option<KillCredit> {
    let (victim, n) = varint(b, at)?;
    if !(100..=9_999_999).contains(&victim) {
        return None;
    }
    let j = at + n + 4; // a u32: a skill id for a summon, 0 otherwise
    let (killer, n2) = varint(b, j)?;
    let j = j + n2;
    let server = u16_at(b, j)?;
    let (name, end) = text(b, j + 2, 36)?;
    if !name.chars().all(|c| !c.is_control()) {
        return None;
    }
    let legion = text(b, end, 48).map(|(s, _)| s).filter(|s| !s.is_empty());
    // The last byte of the record: Nyerk reads it as the frame's last byte, as
    // a credit is a frame of its own when it is a player's death.
    let player_victim = b.last() == Some(&1) && at == varint(b, 0).map_or(0, |(_, n)| n + 2);
    Some(KillCredit { victim, killer, server, name, legion, player_victim })
}

/// A length-prefixed UTF-8 string of 1..=max bytes at `at`, and where it ends.
fn text(b: &[u8], at: usize, max: usize) -> Option<(String, usize)> {
    let n = *b.get(at)? as usize;
    if !(1..=max).contains(&n) {
        return None;
    }
    let s = std::str::from_utf8(b.get(at + 1..at + 1 + n)?).ok()?;
    Some((s.to_string(), at + 1 + n))
}

/// A character name: 1-32 bytes of UTF-8 letters and digits.
fn name_at(b: &[u8], at: usize) -> Option<String> {
    let (s, _) = text(b, at, 32)?;
    s.chars().all(char::is_alphanumeric).then_some(s)
}

/// `0D 90 <count u8> count × (<pet u32> <amount u32>)`: souls picked up, sent
/// only to you. One kill can give souls for several pets: each is listed.
pub fn souls(frame: &[u8]) -> Option<Vec<(u32, u32)>> {
    let b = body(frame, OP_SOUL)?;
    let count = *b.first()? as usize;
    if count == 0 || b.len() < 1 + count * 8 {
        return None;
    }
    let mut out = Vec::with_capacity(count);
    for k in 0..count {
        let pet = u32_at(b, 1 + k * 8)?;
        let amount = u32_at(b, 5 + k * 8)?;
        if !PET_IDS.contains(&pet) || !(1..MAX_SOULS).contains(&amount) {
            return None;
        }
        out.push((pet, amount));
    }
    Some(out)
}

/// `14 90 <2 bytes> <pet u32> <level u32>`: a pet reached a level.
pub fn level_up(frame: &[u8]) -> Option<(u32, u32)> {
    let b = body(frame, OP_LEVEL_UP)?;
    let pet = u32_at(b, 2)?;
    let level = u32_at(b, 6)?;
    (PET_IDS.contains(&pet) && (1..=3).contains(&level)).then_some((pet, level))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Crystal {
    pub genus: u8,
    pub amount: u32,
    pub raw: Vec<u8>,
}

/// `11 90 01 <genus u8> <amount u32> 02`: genus crystals from a monster whose
/// pet is maxed. It names no pet: the kill just before it does.
pub fn crystal(frame: &[u8]) -> Option<Crystal> {
    let b = body(frame, OP_CRYSTAL)?;
    if b.len() < 6 || b[0] != 0x01 {
        return None;
    }
    let amount = u32_at(b, 2)?;
    (1..MAX_SOULS).contains(&amount).then(|| Crystal { genus: b[1], amount, raw: b.to_vec() })
}

/// The genus byte of `11 90`, as seen. Natura and Varian not captured yet.
pub fn crystal_genus(byte: u8) -> Option<&'static str> {
    match byte {
        1 => Some("fera"),
        2 => Some("cogni"),
        _ => None,
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Collection {
    /// pet -> level
    pub levels: Vec<(u32, u32)>,
    /// pet -> souls, as the Pets menu shows them
    pub souls: Vec<(u32, u32)>,
}

/// `00 90 <u32> <varint n> n × (<pet u32> <pet u32> <level u32>) <varint m>
/// m × (<pet u32> <souls u32>) ...`: your whole collection, sent once as you
/// enter the world. Anything that doesn't read as pets (a pet id out of
/// range, a level past 3, a count past 1000) gives no sync at all: better no
/// sync than a wrong one.
pub fn collection(frame: &[u8]) -> Option<Collection> {
    let b = body(frame, OP_COLLECTION)?;
    let mut pos = 4;
    let (n, ln) = varint(b, pos)?;
    pos += ln;
    let mut out = Collection::default();
    for _ in 0..n {
        let (pet, pet2, level) = (u32_at(b, pos)?, u32_at(b, pos + 4)?, u32_at(b, pos + 8)?);
        if pet != pet2 || !PET_IDS.contains(&pet) || level > 3 {
            return None;
        }
        out.levels.push((pet, level));
        pos += 12;
    }
    let (m, ln) = varint(b, pos)?;
    pos += ln;
    for _ in 0..m {
        let (pet, souls) = (u32_at(b, pos)?, u32_at(b, pos + 4)?);
        if !PET_IDS.contains(&pet) || souls >= MAX_SOULS {
            return None;
        }
        out.souls.push((pet, souls));
        pos += 8;
    }
    Some(out)
}

/// `21 36 <u32> <u32 map id> <8 bytes> <f32 x> <f32 y> <f32 z> ...`: every zone load.
pub fn map_load(frame: &[u8]) -> Option<(u32, f32, f32)> {
    let b = body(frame, OP_MAP_LOAD)?;
    if b.len() < 28 {
        return None;
    }
    Some((u32_at(b, 4)?, f32_at(b, 16)?, f32_at(b, 20)?))
}

/// `23 36 00 <5 bytes> <f32 x> <f32 y> <f32 z>`: entity 0, you, placed somewhere.
pub fn self_teleport(frame: &[u8]) -> Option<(f32, f32)> {
    let b = body(frame, OP_TELEPORT)?;
    if b.len() < 18 || b[0] != 0 {
        return None;
    }
    Some((f32_at(b, 6)?, f32_at(b, 10)?))
}

/// Heights seen run 11,000 to 30,000; a coordinate read as a height is far above this.
const MAX_HEIGHT: f32 = 100_000.0;

/// An x, y, z at `off` that reads as a place: x and y within ±500,000 and past
/// ±1,000 (smaller values are other fields read as floats), z under MAX_HEIGHT.
fn place_at(b: &[u8], off: usize) -> Option<(f32, f32)> {
    let (x, y, z) = (f32_at(b, off)?, f32_at(b, off + 4)?, f32_at(b, off + 8)?);
    let coord = |v: f32| (1000.0..500_000.0).contains(&v.abs());
    (coord(x) && coord(y) && z.abs() < MAX_HEIGHT).then_some((x, y))
}

/// `02 38` / `03 38 <caster varint> 00 <target varint> <skill u32> ... <x y z f32>`:
/// the caster, and where its **target** stands, not the caster (Nyerk
/// 2026-10-17: 938 of 986 casts matched the target's movement); close to the
/// caster only for melee and gathering. The first plausible place after the
/// skill: the height check keeps a field reading 1,413.8 from passing as an x
/// (1 cast in 11 was misread that way).
pub fn cast(frame: &[u8]) -> Option<(u32, f32, f32)> {
    let b = OP_CASTS.iter().find_map(|&op| body(frame, op))?;
    let (actor, n) = varint(b, 0)?;
    (n + 6..(b.len().saturating_sub(12)).min(n + 24)).find_map(|off| place_at(b, off).map(|(x, y)| (actor, x, y)))
}

/// The target of a `02 38` / `03 38` cast: `<caster varint> 00 <target varint>`. The place
/// `cast` reads is this target's.
pub fn cast_target(frame: &[u8]) -> Option<u32> {
    let b = OP_CASTS.iter().find_map(|&op| body(frame, op))?;
    let (_, n) = varint(b, 0)?;
    if *b.get(n)? != 0 {
        return None;
    }
    varint(b, n + 1).map(|(target, _)| target).filter(|&t| t != 0)
}

/// Epoch ms, 2020 to 2128: how the time in an effect record is found. Effects
/// that never run out carry the end of 2099.
const EFFECT_MS: std::ops::Range<u64> = 1_580_000_000_000..5_000_000_000_000;

/// `2A 38` / `2B 38 <source varint> ... <u64 ms> <target varint> <0-8 bytes>
/// <x y z f32>`: an effect put on the target (a buff, a heal, a hit's debuff,
/// whoever put it there), and where the target stands (Nyerk 0.2.17: all
/// 112,742 effect records of a capture read this way, median error 0 against
/// the entities' own movement). A field before the time can read as one, so
/// each window that does is tried in turn.
pub fn effect_position(frame: &[u8]) -> Option<(u32, f32, f32)> {
    let b = OP_EFFECTS.iter().find_map(|&op| body(frame, op))?;
    (1..b.len().saturating_sub(8).min(40)).find_map(|i| {
        if !u64_at(b, i).is_some_and(|t| EFFECT_MS.contains(&t)) {
            return None;
        }
        let (target, n) = varint(b, i + 8)?;
        if target == 0 {
            return None;
        }
        let start = i + 8 + n;
        (start..(start + 9).min(b.len().saturating_sub(11))).find_map(|off| place_at(b, off).map(|(x, y)| (target, x, y)))
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct Character {
    pub entity: u32,
    pub name: String,
    pub server: u16,
    /// The class number (`roster_class`), level and gear score, when they read as such.
    pub class: Option<u32>,
    pub level: Option<u32>,
    pub gear_score: Option<u32>,
}

/// `33 36 <entity varint> <5 bytes> <len u8> <name> <server u16> <class u32> <u8> <level u32>
/// <gear score u32> ...`: you, on every zone entry (logins included, right after the
/// collection). Ksix 1406: class 6, Lv45, 2732 gear score (the owner's 2026-10-31 log; NCSoft's
/// item level for her says 2732 too).
pub fn character(frame: &[u8]) -> Option<Character> {
    let b = body(frame, OP_SELF)?;
    let (entity, pos) = varint(b, 0)?;
    (pos..(pos + 12).min(b.len())).find_map(|p| {
        let name = name_at(b, p)?;
        let end = p + 1 + name.len();
        let class = u32_at(b, end + 2).filter(|c| roster_class(*c).is_some());
        let level = u32_at(b, end + 7).filter(|l| (1..=99).contains(l));
        let gear_score = u32_at(b, end + 11).filter(|g| *g < 100_000);
        let read = class.is_some() && level.is_some() && gear_score.is_some();
        Some(Character {
            entity,
            server: u16_at(b, end)?,
            name,
            class: class.filter(|_| read),
            level: level.filter(|_| read),
            gear_score: gear_score.filter(|_| read),
        })
    })
}

/// One character of the account, as the character selection screen lists them.
#[derive(Debug, Clone, PartialEq)]
pub struct ListedCharacter {
    pub name: String,
    pub server: u16,
    /// NCSoft's key for the character: `<server u16> 00 00 <number u32>`, as a u64. Their
    /// portrait is `profileimg.plaync.com/...?gameServerKey=<server>&charKey=<key>`.
    pub key: u64,
    /// The class number (`roster_class`).
    pub class: u32,
    pub level: u32,
    pub gear_score: u32,
    pub legion: Option<String>,
}

/// `15 36 <u16> <u64 ms> <u64 ms> <count u8>`, then per character `<u32> <len><name> <class u32>
/// <u8> <u8> <level u32> <4 bytes> <gear score u32> <20 bytes> <len><legion> ...` and its gear
/// and looks, some 2.5 KB, with `<key u64> <u32> <u64 ms>` in the last part: the server's characters, as you
/// pick the server (the owner's 2026-10-31 log, 5 characters on Ariel). A character is found
/// where those fields read as such; its key is the first `<number u32> 00 00 <server u16>` after
/// them with a time 4 bytes on.
pub fn character_list(frame: &[u8]) -> Option<Vec<ListedCharacter>> {
    let b = body(frame, OP_CHARACTER_LIST)?;
    let count = *b.get(18)? as usize;
    // Each character's place: its name, and where its fixed fields end.
    let mut found: Vec<(usize, String, u32, u32, u32)> = Vec::new();
    let mut at = 19;
    while at + 40 < b.len() && found.len() < count {
        let hit = name_at(b, at).and_then(|name| {
            let end = at + 1 + name.len();
            let class = u32_at(b, end)?;
            let level = u32_at(b, end + 6)?;
            let gear_score = u32_at(b, end + 14)?;
            let ok = roster_class(class).is_some() && (1..=2).contains(b.get(end + 4)?) && (1..=99).contains(&level) && gear_score < 100_000;
            ok.then_some((end, name, class, level, gear_score))
        });
        match hit {
            Some(c) => {
                at = c.0 + 38;
                found.push(c);
            }
            None => at += 1,
        }
    }
    if found.len() != count {
        return None;
    }
    let mut out = Vec::with_capacity(count);
    for (i, (end, name, class, level, gear_score)) in found.iter().enumerate() {
        let stop = found.get(i + 1).map_or(b.len(), |n| n.0);
        let key = (end + 38..stop.saturating_sub(8)).find_map(|k| {
            let server = u16_at(b, k + 6)?;
            let ok = (1000..=9999).contains(&server) && u16_at(b, k + 4)? == 0 && u32_at(b, k)? != 0 && plausible_ms(b, k + 12);
            ok.then(|| (u64_at(b, k), server))
        })?;
        let legion = text(b, end + 38, 48).map(|(s, _)| s).filter(|s| s.chars().all(|c| !c.is_control()));
        out.push(ListedCharacter { name: name.clone(), server: key.1, key: key.0?, class: *class, level: *level, gear_score: *gear_score, legion });
    }
    Some(out)
}

/// `0B 61 <count varint>`, then per counter `<flags u8> <id u32>` and its values: a u64 for each
/// of flags 01 and 02, a varint for each of 04 and 08 (a value of 0 is left out, its flag
/// clear; read back as 0 when a later value follows, so each keeps its place). Your character's
/// counters, at login: Odyle energy is 60000001 (basic, charged), the Shugo Festival keys 1 (the
/// owner's 2026-10-31 logs, 73 counters), Nightmare 4 (daily entries, tickets), the Ascension
/// Trial's entries left 80000001 and its weekly cap 70000001 (a friend's captures, server 1406).
pub fn counters(frame: &[u8]) -> Option<Vec<(u32, Vec<u64>)>> {
    let b = body(frame, OP_COUNTERS)?;
    let (count, mut at) = varint(b, 0)?;
    let mut out = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let (id, values, n) = counter_at(b, at)?;
        out.push((id, values));
        at += n;
    }
    (at == b.len()).then_some(out)
}

/// One counter of `counters`' list at `at`: its id, values and length.
fn counter_at(b: &[u8], start: usize) -> Option<(u32, Vec<u64>, usize)> {
    let flags = *b.get(start)?;
    if flags & 0xF0 != 0 {
        return None;
    }
    let id = u32_at(b, start + 1)?;
    let mut at = start + 5;
    let mut values = Vec::new();
    // The second of a pair alone: the first was 0.
    if flags & 0x03 == 0x02 {
        values.push(0);
    }
    for bit in [0x01, 0x02] {
        if flags & bit != 0 {
            values.push(u64_at(b, at)?);
            at += 8;
        }
    }
    if flags & 0x0C == 0x08 {
        values.push(0);
    }
    for bit in [0x04, 0x08] {
        if flags & bit != 0 {
            let (v, n) = varint(b, at)?;
            values.push(v as u64);
            at += n;
        }
    }
    Some((id, values, at - start))
}

/// `0C 61 00 <counter as in counters> <u8>`: one counter changed, while you play. The Abyss's
/// Artifact corridors are 10000001-10000003 (Reshanta's Root, Sulfur Tree Island, Archipelago of
/// Siel's Wings): their passage time (130000 ms, the "02:10" the game shows) given when you enter
/// the Abyss after a reset, and cleared once the corridor is done; your Abyss time (3) ticks while
/// you are there (the owner's 2026-11-01 logs).
pub fn counter(frame: &[u8]) -> Option<(u32, Vec<u64>)> {
    let b = body(frame, OP_COUNTER)?;
    if b.first() != Some(&0) {
        return None;
    }
    let (id, values, n) = counter_at(b, 1)?;
    (1 + n + 1 == b.len()).then_some((id, values))
}

const KINA_ITEM: [u8; 4] = [0x3f, 0x33, 0x70, 0x37];

/// Your Kina balance: `1B 56 01 01 00 <u32> <u32> 3f 33 70 37 <balance u64>`.
/// The same opcode carries other stacks with other item bytes.
pub fn kina(frame: &[u8]) -> Option<u64> {
    let b = body(frame, OP_ITEM)?;
    if b.len() < 23 || b[0] != 0x01 || b[11..15] != KINA_ITEM {
        return None;
    }
    u64_at(b, 15)
}

#[derive(Debug, Clone, PartialEq)]
pub struct FieldBoss {
    pub id: u32,
    pub up: bool,
    /// up: when it spawned (0 since the 2026-10-14 patch); dead: when it respawns
    pub at_ms: u64,
}

fn plausible_ms(b: &[u8], at: usize) -> bool {
    u64_at(b, at).is_some_and(|v| (1_600_000_000_000..2_200_000_000_000).contains(&v))
}

/// `01 91 <u16> <world u32> <count u8>`, then per boss: up `01 <id varint>
/// <x y z f32> [1 byte] <spawned u64 ms>`, dead `00 <id varint> <respawns u64
/// ms>`: the map's field boss list, every ~3 s while the map is open. Some
/// entries carry a byte more before the time, so the time is found where an ms
/// timestamp fits.
pub fn field_bosses(frame: &[u8]) -> Option<(u32, Vec<FieldBoss>)> {
    let b = body(frame, OP_FIELD_BOSSES)?;
    let world = u32_at(b, 2)?;
    let n = *b.get(6)?;
    let mut pos = 7;
    let mut out = Vec::with_capacity(n as usize);
    for _ in 0..n {
        let up = match b.get(pos)? {
            0 => false,
            1 => true,
            _ => return None,
        };
        let (id, ln) = varint(b, pos + 1)?;
        pos += 1 + ln;
        if up {
            pos += 12;
            if pos > b.len() {
                return None;
            }
        }
        pos += (0..5).find(|&k| plausible_ms(b, pos + k))?;
        out.push(FieldBoss { id, up, at_ms: u64_at(b, pos)? });
        pos += 8;
    }
    Some((world, out))
}

/// A field boss id as the map's list names them (101001 Neikel of the East, 101021 Eternal Gartua...).
fn boss_id(v: u32) -> bool {
    (101_001..=101_099).contains(&v)
}

/// How many different field boss ids a frame names, as varints or u32s: a diagnostic, to find the
/// messages that carry the bosses besides the list `field_bosses` reads.
pub fn boss_ids_in(frame: &[u8]) -> usize {
    let mut seen: Vec<u32> = Vec::new();
    for i in 0..frame.len() {
        let as_u32 = u32_at(frame, i).filter(|&v| boss_id(v));
        let as_varint = varint(frame, i).map(|(v, _)| v).filter(|&v| boss_id(v));
        for v in [as_u32, as_varint].into_iter().flatten() {
            if !seen.contains(&v) {
                seen.push(v);
            }
        }
    }
    seen.len()
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ShopItem {
    pub slot: u32,
    pub item: u32,
    pub quantity: u64,
    pub currency: u8,
    pub base: u64,
    pub price: u64,
}

const SHOP_RECORD: usize = 34;

fn shop_record(b: &[u8], o: usize) -> Option<ShopItem> {
    if o + SHOP_RECORD > b.len() {
        return None;
    }
    let item = ShopItem {
        slot: u32_at(b, o)?,
        item: u32_at(b, o + 4)?,
        quantity: u64_at(b, o + 8)?,
        currency: b[o + 17],
        base: u64_at(b, o + 18)?,
        price: u64_at(b, o + 26)?,
    };
    let ok = (1..1 << 24).contains(&item.slot)
        && item.item >= 100_000_000
        && (1..1_000_000).contains(&item.quantity)
        && item.price > 0
        && item.price <= item.base
        && item.base < 1_000_000_000_000;
    ok.then_some(item)
}

/// `91 56 <tab u8> <count u8>`, then per item `<slot u32> <item u32> <quantity
/// u64> <discount tier u8> <currency u8> <base u64> <price u64>`, then `<next
/// restock u64 ms>`: one Black Cloud Merchant tab, as it is opened. Some
/// records start one byte later, so each is tried where expected and one on.
pub fn shop(frame: &[u8]) -> Option<(u8, Vec<ShopItem>, Option<u64>)> {
    let b = body(frame, OP_SHOP)?;
    let (tab, count) = (*b.first()?, *b.get(1)?);
    let mut o = 2;
    let mut items = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let (start, item) = [o, o + 1].into_iter().find_map(|s| shop_record(b, s).map(|r| (s, r)))?;
        items.push(item);
        o = start + SHOP_RECORD;
    }
    let next = u64_at(b, o).filter(|&t| (1_500_000_000_000..4_000_000_000_000).contains(&t));
    Some((tab, items, next))
}

/// A world object (a gadget) coming into view, a Hidden Cube among them.
/// Layouts from dr89mh/aion2-cube-radar (GPL-3.0), `ObjectMessages.cs` and
/// docs/FINDINGS.md, checked there against cubes opened in its own captures.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ObjectSpawn {
    pub id: u32,
    pub template: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    /// When it spawned (ms since 1970); None when the record has no time.
    pub created_ms: Option<u64>,
}

/// `34 36 <id varint> <kind u16> <template u32> <x y z f32> <f32> <heading f32>
/// <u8 u8 state u8> <created u64 ms> ...`: an object in view, sent once you are
/// within its range (about 100 m for a cube).
pub fn object_spawn(frame: &[u8]) -> Option<ObjectSpawn> {
    let b = body(frame, OP_OBJECT_SPAWN)?;
    let (id, o) = varint(b, 0)?;
    if o + 26 > b.len() {
        return None;
    }
    let (x, y, z) = (f32_at(b, o + 6)?, f32_at(b, o + 10)?, f32_at(b, o + 14)?);
    if !(x.is_finite() && y.is_finite() && z.is_finite()) {
        return None;
    }
    let created_ms = u64_at(b, o + 29).filter(|t| (1_600_000_000_000..2_600_000_000_000).contains(t));
    Some(ObjectSpawn { id, template: u32_at(b, o + 2)?, x, y, z, created_ms })
}

/// `35 36 <id varint> <reason u8> ...`: an object gone from view: 04 destroyed
/// (a cube opened), 01 out of range.
pub fn object_removed(frame: &[u8]) -> Option<(u32, u8)> {
    let b = body(frame, OP_OBJECT_REMOVED)?;
    let (id, o) = varint(b, 0)?;
    Some((id, *b.get(o)?))
}

/// A player coming into view: `45 36 <entity varint> <4 bytes> 17 <len><name>
/// <u32> <faction u8> ...`, and some 100-120 bytes on `<server u16> <2 bytes>
/// 00 00 00 00 <server u16> <len><legion>` (Nyerk 0.2.17). The faction byte is
/// 1 Elyos, 2 Asmodian, as the server's thousands are (1406 Elyos, 2406
/// Asmodian: the 2026-10-21 and 10-25 packet logs).
#[derive(Debug, Clone, PartialEq)]
pub struct Player {
    pub entity: u32,
    pub name: String,
    pub server: Option<u16>,
    pub legion: Option<String>,
    /// 1 Elyos, 2 Asmodian: the server's, else the byte after the name's u32.
    pub faction: Option<u8>,
    /// The u32 right after the name: the class number (`roster_class`), as target info has it.
    pub class: Option<u32>,
    /// Where they stand, game (x, y): 8 bytes after the name (all 8 players of the 2026-10
    /// captures; Wolf's matched his effects' position to the unit).
    pub place: Option<(f32, f32)>,
    /// Their combat power, as the game shows it (`spawn_combat_power`).
    pub combat_power: Option<u32>,
    /// Their PvP switched on as they came into view: bit 02 of the fourth byte after the entity.
    /// Set on Coby, Tributação and RazielGT (PvP on, fought), clear on ZergBR and FAT (off): the
    /// owner's 2026-10-26 and 10-28 logs. SophieGreen, Zuharïs and Yamiel came in with it clear and
    /// switched it on in view (`pvp_switch`) before their fights. Later switches come as `54 36`.
    pub pvp: bool,
    /// Where they stand everyone can fight, PvP switched on or not (the Abyss): bit 10 of the
    /// fifth byte after the entity, the one before the name's length. 17 in every spawn of the
    /// owner's Abyss logs (2026-10-26 15:07-15:42, 10-27 02:23), 07 in all of the Altgard ones.
    pub open_pvp: bool,
}

pub const ELYOS: u8 = 1;
pub const ASMODIAN: u8 = 2;

/// A server's faction: 1xxx Elyos, 2xxx Asmodian.
pub fn server_faction(server: u16) -> Option<u8> {
    match server / 1000 {
        1 => Some(ELYOS),
        2 => Some(ASMODIAN),
        _ => None,
    }
}

pub fn player(frame: &[u8]) -> Option<Player> {
    let b = body(frame, OP_PLAYER)?;
    let (entity, pos) = varint(b, 0)?;
    let (name, at, end) = (pos..(pos + 12).min(b.len())).find_map(|p| {
        let name = name_at(b, p)?;
        let end = p + 1 + name.len();
        Some((name, p, end))
    })?;
    let mut server = None;
    let mut legion = None;
    for k in end + 40..(end + 200).min(b.len().saturating_sub(10)) {
        let v = u16_at(b, k)?;
        if (1000..=9999).contains(&v) && b[k + 4..k + 8] == [0, 0, 0, 0] && u16_at(b, k + 8) == Some(v) {
            server = Some(v);
            legion = text(b, k + 10, 48).map(|(s, _)| s);
            break;
        }
    }
    let server = server.or_else(|| unguilded_server(b, end));
    let faction = server.and_then(server_faction).or_else(|| b.get(end + 4).copied().filter(|f| [ELYOS, ASMODIAN].contains(f)));
    let class = u32_at(b, end).filter(|&c| roster_class(c).is_some());
    let place = place_at(b, end + 8);
    let combat_power = spawn_combat_power(b, end);
    let pvp = at == pos + 5 && b[pos + 3] & 0x02 != 0;
    let open_pvp = at == pos + 5 && b[pos + 4] & 0x10 != 0;
    Some(Player { entity, name, server, legion, faction, class, place, combat_power, pvp, open_pvp })
}

/// What every item of a player's gear in their spawn ends with.
const SPAWN_ITEM_TAIL: [u8; 14] = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x80, 0x75, 0xd5, 0x2a, 0xbb, 0x03];

/// The server of a player in no legion: there, the server is not repeated around a legion's name
/// but sits once before their gear, `<server u16> <count u8> <10, 11 or 13> ...`, the first such
/// past the stats with the faction the spawn states (Dæps 2406 and Elyos of the 2026-10-26 logs).
fn unguilded_server(b: &[u8], name_end: usize) -> Option<u16> {
    let faction = *b.get(name_end + 4)?;
    let tail = name_end + b.get(name_end..)?.windows(SPAWN_ITEM_TAIL.len()).position(|w| w == SPAWN_ITEM_TAIL)?;
    (name_end + 40..tail.saturating_sub(4))
        .filter(|&k| (1..=40).contains(&b[k + 2]) && [0x10, 0x11, 0x13].contains(&b[k + 3]))
        .find_map(|k| u16_at(b, k).filter(|&v| server_faction(v) == Some(faction)))
}

/// The mark the combat power follows in a player's spawn, at its last place after the name.
const SPAWN_CP_MARK: [u8; 3] = [0xf4, 0xcb, 0x1f];

/// A spawn's combat power: after the last `f4 cb 1f` past the name, two u32, sometimes one more
/// byte, then the combat power as a u64 (and a byte, mostly 0: 1 and 2 seen too). Taken only when the two readings (with
/// and without that byte) agree on one believable value. From another overlay's author (MarceUY,
/// `FindSpawnCombatPower`), checked on SquarX in the owner's 2026-10-26 log: 115485, shown 115.4k.
fn spawn_combat_power(b: &[u8], name_end: usize) -> Option<u32> {
    let rest = b.get(name_end..)?;
    let mark = name_end + rest.windows(3).rposition(|w| w == SPAWN_CP_MARK)?;
    let read = |at: usize| u64_at(b, at).filter(|v| (1_000..=10_000_000).contains(v));
    let at = mark + 3 + 8;
    match (read(at), read(at + 1)) {
        (Some(a), Some(b)) if a != b => None,
        (a, b) => a.or(b).map(|v| v as u32),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerCard {
    pub name: String,
    pub server: u16,
    /// The class number (`roster_class`).
    pub class: u32,
    pub level: u32,
    pub gear_score: u32,
    pub combat_power: u32,
}

/// `30 97 <character u32> 00 00 <server u16> <class u32> <level u32> <gear score u32>
/// <len><name> <server u16> 00 00 00 00 <combat power u32> ...`: a player's
/// card, its numbers as the game shows them (Shiggly 1406, Lv45, 2630 gear
/// score, 123186 combat power: the owner's 2026-10-26 packet log). The
/// character id is not the one players in view go by: the card is matched by
/// name and server.
pub fn player_card(frame: &[u8]) -> Option<PlayerCard> {
    let b = body(frame, OP_PLAYER_CARD)?;
    let server = u16_at(b, 6)?;
    let level = u32_at(b, 12)?;
    let gear_score = u32_at(b, 16)?;
    let name = name_at(b, 20)?;
    let end = 21 + name.len();
    let valid = (1000..=9999).contains(&server) && (1..=99).contains(&level) && gear_score < 100_000 && u16_at(b, end) == Some(server);
    valid.then_some(PlayerCard { name, server, class: u32_at(b, 8)?, level, gear_score, combat_power: u32_at(b, end + 6)? })
}

/// `54 36 <entity varint> <01 on | 00 off>`: a player in view (you too) switching their PvP. Seen
/// on: you, then SophieGreen, Zuharïs and Yamiel a few seconds before their fights (the owner's
/// 2026-10-26 23:02 log). Off is assumed to be 00, not seen yet.
pub fn pvp_switch(frame: &[u8]) -> Option<(u32, bool)> {
    let b = body(frame, OP_PVP_SWITCH)?;
    let (entity, n) = varint(b, 0)?;
    match b.get(n..)? {
        [on] if *on <= 1 => Some((entity, *on == 1)),
        _ => None,
    }
}

/// `47 36 <entity varint> <reason u16>`: a player out of your view (out of
/// range 01, 02, a teleport 0a...). In every capture so far it follows only
/// players' `45 36`, never a monster's (those leave with `42 36`).
pub fn player_gone(frame: &[u8]) -> Option<u32> {
    let b = body(frame, OP_PLAYER_GONE)?;
    let (entity, n) = varint(b, 0)?;
    (b.len() >= n + 2).then_some(entity)
}

/// A class by the number party records and target info carry: four values a class, which differ
/// by something else about the character (A2Tools' `JobClass::from_roster_class`, matched
/// against 14 players; Wolf's 13 and Shiggly's 14 both Rangers, as the owner confirmed). Named as
/// the meter names them.
pub fn roster_class(value: u32) -> Option<&'static str> {
    Some(match value {
        5..=8 => "Gladiator",
        9..=12 => "Templar",
        13..=16 => "Ranger",
        17..=20 => "Assassin",
        21..=24 => "Spiritmaster",
        25..=28 => "Sorcerer",
        29..=32 => "Cleric",
        33..=36 => "Chanter",
        _ => return None,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct TargetInfo {
    pub name: String,
    pub server: u16,
    pub level: u32,
    pub gear_score: u32,
    /// The class number (`roster_class`).
    pub class: u32,
    pub legion: Option<String>,
    /// As read: the tracker keeps only believable values (`steady_cp`).
    pub combat_power: u32,
}

/// The combat power's place in target info: this many bytes before the end of the body.
const TARGET_CP_FROM_END: usize = 33;

/// `50 36 00 00 <u8> <len><name> <class u32> 01 01 <level u32> <u32> <gear score
/// u32> <server u16> <server u16> ... <server u16> <len><legion> ... <combat
/// power u32> <29 bytes>`, some 3 KB: a player you target, their sheet as the
/// game shows it (Wolf 1406, Lv45, 2429 gear score, 125122 combat power, the
/// owner's 2026-10-26 packet log). Read from one capture: the combat power is
/// where it was there, counted from the end.
pub fn target_info(frame: &[u8]) -> Option<TargetInfo> {
    let b = body(frame, OP_TARGET_INFO)?;
    let (name, at) = (2..6).find_map(|p| name_at(b, p).map(|n| (n, p)))?;
    let end = at + 1 + name.len();
    let class = u32_at(b, end)?;
    let level = u32_at(b, end + 6)?;
    let gear_score = u32_at(b, end + 14)?;
    let server = u16_at(b, end + 18)?;
    if !(1000..=9999).contains(&server) || u16_at(b, end + 20) != Some(server) || !(1..=99).contains(&level) || gear_score >= 100_000 {
        return None;
    }
    let legion = (end + 22..(end + 60).min(b.len().saturating_sub(2)))
        .find(|&k| u16_at(b, k) == Some(server))
        .and_then(|k| text(b, k + 2, 48))
        .map(|(s, _)| s)
        .filter(|s| !s.is_empty());
    let combat_power = u32_at(b, b.len().checked_sub(TARGET_CP_FROM_END)?)?;
    Some(TargetInfo { name, server, level, gear_score, class, legion, combat_power })
}

/// `33 8A <entity varint> <legion id u48> <server u16> <len><name>`: a player's
/// legion, yours included, resent every few seconds (Nyerk 0.2.17).
pub fn legion(frame: &[u8]) -> Option<(u32, String)> {
    let b = body(frame, OP_LEGION)?;
    let (entity, n) = varint(b, 0)?;
    let server = u16_at(b, n + 6)?;
    let (name, _) = text(b, n + 8, 48)?;
    (1000..=9999).contains(&server).then_some((entity, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_character_list_reads_every_character() {
        let list = character_list(&frame(OP_CHARACTER_LIST, &hex(include_str!("testdata/character-list-ksix.hex")))).unwrap();
        let rows: Vec<_> = list.iter().map(|c| (c.name.as_str(), c.server, roster_class(c.class).unwrap(), c.level, c.gear_score)).collect();
        assert_eq!(
            rows,
            [
                ("Ksix", 1406, "Gladiator", 45, 2732),
                ("Ksixx", 1406, "Templar", 45, 1059),
                ("Ksixxx", 1406, "Ranger", 45, 917),
                ("Ksixxxx", 1406, "Spiritmaster", 45, 1096),
                ("TremendoHeal", 1406, "Cleric", 45, 804),
            ]
        );
        // NCSoft's keys for them, as their search and portraits have them.
        assert_eq!(list[0].key, 395753817255410831);
        assert_eq!(list[1].key, 395753817255417622);
        assert_eq!(list[2].key, 395753817255465709);
        assert_eq!(list[3].key, 395753817255486953);
        assert_eq!(list[4].key, 395753817255505632);
        assert_eq!(list[0].legion.as_deref(), Some("Lokthar"));
        assert_eq!(list[1].legion.as_deref(), Some("Lokthar\u{30c3}"));
    }

    #[test]
    fn the_counters_read_whole() {
        let list = counters(&frame(OP_COUNTERS, &hex(include_str!("testdata/counters-ksix.hex")))).unwrap();
        assert_eq!(list.len(), 73);
        let get = |id: u32| list.iter().find(|(i, _)| *i == id).map(|(_, v)| v.clone());
        assert_eq!(get(60_000_001), Some(vec![60, 155]), "Odyle energy, basic and charged");
        assert_eq!(get(1), Some(vec![20]), "Shugo Festival keys");
        assert_eq!(get(4), Some(vec![11]));
        assert_eq!(get(9), Some(vec![25_200_000]));
        assert_eq!(get(10_000_001), Some(vec![]));
    }

    /// TremendoHeal entering the Abyss after the reset, then finishing Sulfur Tree Island (2026-11-01).
    #[test]
    fn a_corridor_is_given_then_done() {
        let read = |h: &str| counter(&frame(OP_COUNTER, &hex(h)));
        assert_eq!(read("000182969800d0fb01000000000002"), Some((10_000_002, vec![130_000])));
        assert_eq!(read("00008296980003"), Some((10_000_002, vec![])));
        assert_eq!(read("00030300000080fd720000000000e0b43d000000000003"), Some((3, vec![7_536_000, 4_044_000])));
        assert_eq!(read("000182969800d0fb010000000000"), None, "cut short");
    }

    /// A friend's captures (Rawx, server 1406): a Nightmare entered with 14 daily entries and 4
    /// tickets, the Ascension Trial spent to none left, energy spent.
    #[test]
    fn runs_spent_are_told_as_they_happen() {
        let read = |h: &str| counter(&frame(OP_COUNTER, &hex(h)));
        assert_eq!(read("000c040000000d0403"), Some((4, vec![13, 4])), "Nightmare: 13 daily entries, 4 tickets");
        assert_eq!(read("000801b4c4040403"), Some((80_000_001, vec![0, 4])), "the first value left out");
        assert_eq!(read("000001b4c40403"), Some((80_000_001, vec![])), "Ascension Trial: none left");
        assert_eq!(read("000c0187930389021903"), Some((60_000_001, vec![265, 25])), "energy");
    }

    #[test]
    fn you_come_with_your_class_level_and_gear_score() {
        let me = character(&frame(OP_SELF, &hex("c9445f81e32b37044b7369787e0506000000012d000000ac0a0000ac0a00002d000000"))).unwrap();
        assert_eq!((me.name.as_str(), me.server, me.class, me.level, me.gear_score), ("Ksix", 1406, Some(6), Some(45), Some(2732)));
    }

    fn hex(s: &str) -> Vec<u8> {
        let s: String = s.chars().filter(|c| !c.is_whitespace()).collect();
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    /// `<length varint> <opcode> <body>`, by the game's rule (body + opcode + 4).
    pub fn frame(op: [u8; 2], body: &[u8]) -> Vec<u8> {
        let mut v = (body.len() + 2 + 4) as u32;
        let mut out = Vec::new();
        loop {
            let b = (v & 0x7F) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                break;
            }
            out.push(b | 0x80);
        }
        out.extend_from_slice(&op);
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn finds_boss_ids() {
        // 101001 as a varint (89 95 06) and 101021 as a u32 (9d 8a 01 00).
        assert_eq!(boss_ids_in(&[0x05, 0x10, 0x20, 0x89, 0x95, 0x06, 0x00, 0x9d, 0x8a, 0x01, 0x00]), 2);
        assert_eq!(boss_ids_in(&[0x05, 0x10, 0x20, 0x01, 0x02]), 0);
    }

    #[test]
    fn a_soul_pickup_for_two_pets_reads_both() {
        // A2Tools' decoder test: [02, pet 1015 amount 1, pet 1120 amount 1].
        let f = frame(OP_SOUL, &hex("02 f7030000 01000000 60040000 01000000"));
        assert_eq!(souls(&f), Some(vec![(1015, 1), (1120, 1)]));
        let one = frame(OP_SOUL, &hex("01 ee030000 03000000"));
        assert_eq!(souls(&one), Some(vec![(1006, 3)]));
        // A pet id no pet has: a misread, not a soul.
        assert_eq!(souls(&frame(OP_SOUL, &hex("01 f22d0100 01000000"))), None);
    }

    #[test]
    fn a_level_up_names_the_pet_and_its_level() {
        let f = frame(OP_LEVEL_UP, &hex("0000 ee030000 02000000"));
        assert_eq!(level_up(&f), Some((1006, 2)));
    }

    #[test]
    fn a_collection_reads_and_garbage_does_not() {
        let mut body = hex("00000000 02");
        body.extend(hex("ee030000 ee030000 01000000 f7030000 f7030000 03000000"));
        body.extend(hex("02 ee030000 20000000 f7030000 00000000"));
        let c = collection(&frame(OP_COLLECTION, &body)).unwrap();
        assert_eq!(c.levels, vec![(1006, 1), (1015, 3)]);
        assert_eq!(c.souls, vec![(1006, 32), (1015, 0)]);
        // The count a misread gave Pet #77298 (3,845,597,724 souls): no sync.
        let mut bad = hex("00000000 00 01");
        bad.extend(hex("f22d0100 dc0d38e5"));
        assert_eq!(collection(&frame(OP_COLLECTION, &bad)), None);
    }

    #[test]
    fn the_character_record_names_you_and_your_server() {
        let f = frame(OP_SELF, &hex("a135 0000000000 04 4b736978 5004 ff"));
        assert_eq!(character(&f), Some(Character { entity: 6817, name: "Ksix".into(), server: 1104, class: None, level: None, gear_score: None }));
    }

    #[test]
    fn a_kill_credit_names_the_killer() {
        // victim 30001, a u32, killer 1395, server 1104, "Ksix", legion "Lokthar".
        let body = hex("b1ea01 00000000 f30a 5004 04 4b736978 07 4c6f6b74686172 00");
        let f = frame(OP_KILL, &body);
        let got = kill_credits(&f);
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].victim, got[0].killer, got[0].server), (30001, 1395, 1104));
        assert_eq!((got[0].name.as_str(), got[0].legion.as_deref()), ("Ksix", Some("Lokthar")));
        assert!(!got[0].player_victim);
        let mut pvp = body.clone();
        *pvp.last_mut().unwrap() = 1;
        assert!(kill_credits(&frame(OP_KILL, &pvp))[0].player_victim);
    }

    /// The two Verteron cubes of dr89mh/aion2-cube-radar's FINDINGS (B5), opened
    /// there with a key; their positions match th.gl's cube spots exactly.
    #[test]
    fn a_hidden_cube_spawn_and_its_removal_read() {
        let cube = hex("e5ff03 0400 a74f1200 001d44c7 80a5f647 00647146 00000000 00000000 010101 aae4a534a1010000");
        let s = object_spawn(&frame(OP_OBJECT_SPAWN, &cube)).unwrap();
        assert_eq!((s.id, s.template), (65509, 1_200_039));
        assert_eq!((s.x.round(), s.y.round(), s.z.round()), (-50205.0, 126283.0, 15449.0));
        assert!(s.created_ms.is_some());
        assert_eq!(object_removed(&frame(OP_OBJECT_REMOVED, &hex("e5ff03 04 0300"))), Some((65509, 4)));
    }

    #[test]
    fn kina_and_the_shop_read_as_the_python_tracker_did() {
        let f = frame(OP_ITEM, &hex("01 0100 00000000 00000000 3f337037 be86390000000000"));
        assert_eq!(kina(&f), Some(3_770_046));
        let mut body = vec![104, 1];
        body.extend(1u32.to_le_bytes());
        body.extend(150_000_001u32.to_le_bytes());
        body.extend(1u64.to_le_bytes());
        body.extend([0, 1]);
        body.extend(1000u64.to_le_bytes());
        body.extend(900u64.to_le_bytes());
        body.extend(1_792_350_000_000u64.to_le_bytes());
        let (tab, items, next) = shop(&frame(OP_SHOP, &body)).unwrap();
        assert_eq!((tab, items.len(), items[0].price, next), (104, 1, 900, Some(1_792_350_000_000)));
    }

    #[test]
    fn a_player_in_view_reads_its_faction() {
        // Two players from the 2026-10-25 packet log, their first 200 bytes: an Asmodian (2406) and an Elyos (1406).
        let asmo = player(&frame(OP_PLAYER, &hex("b1490320a401070a4c6f706572616d69646117000000020100d20cda5f48765c52c800a027456d948b4383c601826e826ef40e0000f40e00000000000000000000c80d0200c80d020000000000f049020001000000a0860100a0860100d04e0900d04e090002a467650250e56302cdd84f01660914020000000066090a53796e646963617465330200020000000000000000000000000000000a1126815ffd09ffffffffffffffff8075d52abb030000b1490f006cc35f4825d051c8001028451127017a030affff"))).unwrap();
        assert_eq!((asmo.name.as_str(), asmo.server, asmo.faction), ("Loperamida", Some(2406), Some(ASMODIAN)));
        let (x, y) = asmo.place.unwrap();
        assert!((x - 229_224.0).abs() < 1.0 && (y + 215_410.0).abs() < 1.0, "{x} {y}");
        let ely = player(&frame(OP_PLAYER, &hex("ab620320a001070659616b617a6506000000010280d214746148345c52c8bddc1e4553c57e432cb50000b3ca01dc0e0000dc0e000000000000000000005c0602004833020080890000f049020001000000a0860100a08601004a11090070d50a000100000001084ecb0138d6cc01ee1753027e052400000000007e05084f6c6450617274790100020000000000000000000000000000000d11122bc4c901ffffffffffffffff8075d52abb030000ab620100c8fb3e478ef8144800c4b94611133fc4c901ffffffff"))).unwrap();
        assert_eq!((ely.server, ely.faction), (Some(1406), Some(ELYOS)));
    }

    #[test]
    fn a_player_in_view_reads_its_pvp_switch() {
        // Coby (PvP on, 2026-10-26 23:47) and ZergBR (off, 2026-10-28): the same first byte, 03.
        let coby = player(&frame(OP_PLAYER, &hex("a00b0320a4030704436f627924000000020280d2c45e9fc7162d95c7"))).unwrap();
        let zerg = player(&frame(OP_PLAYER, &hex("ab080320a40107065a65726742521b000000020180d2bc941948a4df2248"))).unwrap();
        assert_eq!((coby.name.as_str(), coby.pvp), ("Coby", true));
        assert_eq!((zerg.name.as_str(), zerg.pvp), ("ZergBR", false));
        assert!(!coby.open_pvp && !zerg.open_pvp);
        assert_eq!(pvp_switch(&frame(OP_PVP_SWITCH, &hex("f06c01"))), Some((13936, true)));
        // The Abyss: Lag3rth4, PvP off but there to fight (the owner's 2026-10-27 02:23 log).
        let lag = player(&frame(OP_PLAYER, &hex("ce110530a00117084c616733727468340800000002020240"))).unwrap();
        assert_eq!((lag.name.as_str(), lag.pvp, lag.open_pvp), ("Lag3rth4", false, true));
    }

    #[test]
    fn a_player_in_view_reads_its_combat_power() {
        // SquarX (2308 gear score, 115.4k combat power in game), from the 2026-10-26 15:07 log.
        let squarx = player(&frame(OP_PLAYER, &hex(include_str!("testdata/spawn-squarx.hex")))).unwrap();
        assert_eq!((squarx.name.as_str(), squarx.combat_power), ("SquarX", Some(115_485)));
        // An Asmodian whose spawn ends at the combat power's zero byte (2026-10-26 15:32 log).
        let daeps = player(&frame(OP_PLAYER, &hex(include_str!("testdata/spawn-daeps.hex")))).unwrap();
        assert_eq!((daeps.name.as_str(), daeps.faction, daeps.combat_power), ("Dæps", Some(ASMODIAN), Some(86_671)));
        assert_eq!(daeps.server, Some(2406));
        // Cut before the mark: none.
        let b = hex(include_str!("testdata/spawn-squarx.hex"));
        assert_eq!(player(&frame(OP_PLAYER, &b[..200])).map(|p| p.combat_power), Some(None));
    }

    #[test]
    fn a_player_card_reads_level_gear_score_and_combat_power() {
        let card = player_card(&frame(OP_PLAYER_CARD, &hex("58b00300 0000 7e05 0e000000 2d000000 460a0000 0753686967676c79 7e05 00000000 32e10100 00000000 01000000 007c415e76a1010000"))).unwrap();
        assert_eq!(card, PlayerCard { name: "Shiggly".into(), server: 1406, class: 14, level: 45, gear_score: 2630, combat_power: 123_186 });
        // Not a card: a level of 0.
        assert_eq!(player_card(&frame(OP_PLAYER_CARD, &hex("58b00300 0000 7e05 0e000000 00000000 460a0000 0753686967676c79 7e05 00000000 32e10100"))), None);
    }

    #[test]
    fn target_info_reads_a_players_sheet() {
        let wolf = include_str!("testdata/target-info-wolf.hex");
        let t = target_info(&frame(OP_TARGET_INFO, &hex(wolf))).unwrap();
        assert_eq!(
            t,
            TargetInfo { name: "Wolf".into(), server: 1406, level: 45, gear_score: 2429, class: 13, legion: Some("Flexq".into()), combat_power: 125_122 }
        );
        assert_eq!(roster_class(t.class), Some("Ranger"));
    }
}
