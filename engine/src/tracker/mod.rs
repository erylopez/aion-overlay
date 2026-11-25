//! The overlay's own tracking, on the frames the parser reads (its frame tap):
//! the pet collection and its souls, crystals, Kina, the Black Cloud Merchant,
//! field bosses, what is around you, and player kills. Ported from the Python
//! tracker (`track.py`, from Nyerk), with the pet rules of A2Tools' pet-souls
//! plugin and one collection per game server.
//!
//! Events go out as JSON (the sidecar prints them); the shapes are the Python
//! tracker's, documented in main.rs.

pub mod damage;
pub mod data;
pub mod protocol;
pub mod pvp;
pub mod store;

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;

use a2tools_dps_meter_lib::combat::data_storage::DataStorage;
use a2tools_dps_meter_lib::entity::special_damage::SpecialDamage;
use a2tools_dps_meter_lib::i18n::lookup::NpcLookup;
use serde_json::{Value, json};

use data::PetData;
use protocol as p;
use store::{LEVEL_NEED, MAX_LEVEL, Pet, Store};

/// How long before a soul or crystal its kill can be (the credit comes ~0.3 s before).
const NAME_WINDOW_MS: i64 = 1500;
/// A "combat" event at most this often: the overlay only needs to know fighting is going on.
const COMBAT_EVERY_MS: i64 = 5000;
/// The collection comes just before the record naming the character, in the
/// same bundle: it waits this long for it, then goes to the one playing.
const SYNC_WAIT_MS: i64 = 5000;
/// How long the login's counters wait for the record naming the character (6 s in the owner's logs).
const COUNTERS_WAIT_MS: i64 = 30_000;
/// The Abyss Points a login sends come just before the record naming the character: a total waits
/// this long for one (A2Tools DPS Meter's hold), else it is the character playing's.
const ABYSS_WAIT_MS: i64 = 3000;
/// The most one Abyss Points update can be a gain of (A2Tools DPS Meter's KDA): a bigger jump is a
/// total last seen long ago (points earned while the app was off), taken as the new start.
const ABYSS_MAX_GAIN: u64 = 20_000;
/// A player kill is passed on once per killer and victim in this long.
const PVP_REPEAT_MS: i64 = 30_000;
/// A cast's target this close to where you are is no news of where you are.
const CAST_RANGE: f32 = 2500.0;
/// Faster than this between two places under MAX_JUMP_MS apart is a misread,
/// not you (5,400/s mounted or dashing, in Nyerk's captures).
const MAX_SPEED: f32 = 10_000.0;
const MAX_JUMP_MS: i64 = 2000;
/// The field bosses' monster codes (the app's src/shared/bossRuns.ts names them, by their id in
/// the map's list; questlog.gg's monster ids, which the game's spawns carry): Verteron's 24, Altgard's
/// 24, then the Abyss's 8. One dying in view is told at once (`bossKilled`), for the Boss Runs list.
const FIELD_BOSS_NPCS: [u32; 56] = [
    2_100_003, 2_100_040, 2_100_050, 2_100_076, 2_100_077, 2_100_079, 2_100_141, 2_100_177, 2_100_178, 2_100_582, 2_100_617, 2_100_661,
    2_100_708, 2_100_718, 2_100_876, 2_100_877, 2_100_988, 2_100_989, 2_100_991, 2_101_016, 2_101_074, 2_101_120, 2_101_122, 2_101_131,
    2_400_017, 2_400_074, 2_400_140, 2_400_141, 2_400_212, 2_400_223, 2_400_274, 2_400_335, 2_400_353, 2_400_358, 2_400_419, 2_400_424,
    2_400_425, 2_400_474, 2_400_504, 2_400_593, 2_400_607, 2_400_608, 2_400_659, 2_400_709, 2_400_800, 2_400_853, 2_400_854, 2_400_855,
    2_600_068, 2_600_089, 2_600_084, 2_600_093, 2_600_094, 2_600_096, 2_600_097, 2_600_098,
];

/// The object templates that are Hidden Cubes, with the game's asset name of
/// each, from benhighlanderr/Aion2-Hidden-Cube-Radar (`HIDDEN_CUBE_IDS` in
/// aion2_radar.py). 1200039 and 1200041 (Verteron) were also seen opened in
/// dr89mh/aion2-cube-radar's captures (FINDINGS B5, B9); the rest are that
/// list's alone. Each zone and version of a cube has its own.
const CUBE_TEMPLATES: [u32; 26] = [
    1_000_295, // Basic_HiddenCube_01
    1_000_548, // Basic_HiddenCube_01_V01
    1_000_556, // Basic_HiddenCube_01_V02
    1_000_568, // Basic_HiddenCube_01_V03
    1_000_566, // Basic_HiddenCube_01_V04
    1_000_567, // Basic_HiddenCube_01_V05
    1_100_056, // E_FE_TB_HiddenCube_01
    1_100_094, // E_FE_SpecterEvasion_HiddenCube_01
    1_200_018, // E_HiddenCube_01_001
    1_200_036, // E_HiddenCube_01_001
    1_200_037, // E_HiddenCube_01_002
    1_200_039, // E_HiddenCube_01_V04_001 (Verteron)
    1_200_040, // E_HiddenCube_01_V04_002
    1_200_041, // E_HiddenCube_01_V04_003 (Verteron)
    1_200_667, // E_HiddenCube_01_003
    1_200_707, // E_L1_FE_SpecterEvasion_HiddenCube_01
    1_201_054, // E_HiddenCube_01_004
    1_201_055, // E_HiddenCube_01_005
    1_300_081, // E_D1_TreasureBoxRare_001 (Asmodian)
    1_300_082, // E_D1_TreasureBoxLegend_001 (Asmodian)
    1_300_754, // E_D1_HiddenCube_01 (Asmodian)
    1_301_199, // E_D1_TreasureBoxRare_002 (Asmodian, V04)
    1_301_200, // E_D1_HiddenCube_02 (Asmodian, V04)
    1_401_335, // E_HiddenCube_01_006
    1_401_336, // E_HiddenCube_01_007
    3_682_560, // Special_HiddenCube
];

pub type Emit = Box<dyn Fn(Value) + Send + Sync>;

pub struct Tracker {
    store: Store,
    /// Where the collection is saved; None: never (a replay).
    path: Option<PathBuf>,
    pets: &'static PetData,
    npcs: Arc<NpcLookup>,
    storage: Arc<DataStorage>,
    emit: Emit,

    /// Each character's souls this session, by pet.
    sessions: HashMap<String, HashMap<u32, u32>>,
    /// entity -> monster code, for every spawn seen
    mob_code: HashMap<u32, u32>,
    /// Kills: (ms, monster entity)
    recent: VecDeque<(i64, u32)>,
    /// Kill credits: (ms, monster entity, player credited)
    credits: VecDeque<(i64, u32, u32)>,
    /// Which player is you, by the credits just before your souls: for when
    /// the parser has not learnt it from the game's own records.
    self_votes: HashMap<u32, u32>,
    last_combat: i64,
    /// The collection waiting for the record that names the character.
    pending_sync: Option<(i64, p::Collection)>,
    /// The login's counters (`0B 61`), waiting for the record that names the character: they come
    /// a few seconds before it.
    pending_counters: Option<(i64, Vec<(u32, Vec<u64>)>)>,
    /// Counters changed (`0C 61`) while those wait: theirs too, told after them.
    pending_counter: Vec<(i64, u32, Vec<u64>)>,
    /// The Abyss Points total the game just sent (when, points, limit), waiting to know whose.
    pending_abyss: Option<(i64, u64, u64)>,
    /// Each character's Abyss Points balance as last seen (`1b 56`, item byte 0x23).
    abyss_balance: HashMap<String, u64>,
    /// Your class, level and gear score as last told to the app.
    me_stats: Option<(String, u32, u32, u32)>,
    field_bosses: Option<(u32, Vec<p::FieldBoss>)>,
    /// When a field boss list last could not be read (logged at most once a minute).
    field_bosses_unread: i64,
    /// Scan unknown messages for possible field-boss records while debugging.
    boss_diagnostics: bool,
    /// Other messages naming field bosses, by opcode: when each was last logged.
    boss_messages: HashMap<[u8; 2], i64>,

    /// Around you: monsters loaded (entity -> code), your zone and position (x, -y).
    visible: HashMap<u32, u32>,
    world: Option<u32>,
    position: Option<(f32, f32)>,
    /// When the position was last set, and whether from where you stand (a
    /// zone load, a teleport, an effect on you) rather than a cast's target.
    position_ms: i64,
    position_exact: bool,
    pub nearby_dirty: bool,

    /// The Hidden Cubes in view (sent once you are within about 100 m): object id -> cube.
    cubes: HashMap<u32, p::ObjectSpawn>,
    /// Players in view and their legions, for the kill feed; cleared on each zone load.
    players: HashMap<u32, p::Player>,
    /// Names of players known only from a kill credit (name, server, legion), by entity: who a
    /// selection means when their spawn was not seen. Cleared with the players.
    named: HashMap<u32, (String, u16, Option<String>)>,
    /// Players of the other faction in view: in on `45 36`, out on `42 36` or a new zone.
    enemies: HashMap<u32, p::Player>,
    /// Where each enemy in view was last seen, game (x, y): their arrival, then the effects and
    /// casts that land on them.
    enemy_places: HashMap<u32, (f32, f32)>,
    /// When the enemies' list last went out for a move (moves go out once a second at most).
    enemies_moved_ms: i64,
    /// Hits between you and other players, and the fights saved from them (`pvp`).
    pvp_hits: pvp::Hits,
    /// Players' classes, from the skills they were seen using (`pvp::skill_class`).
    classes: HashMap<u32, &'static str>,
    pvp_fights: pvp::Fights,
    /// Player cards (`30 97`, target info `50 36`) by name and server: level, gear score, combat power.
    cards: HashMap<(String, u16), Card>,
    /// Counts card updates, to tell which card is oldest (`card_mut`).
    card_tick: u64,
    /// Cards changed since they were last written, and when that was (`player-cards.json`, beside
    /// the collection): what was read of a player is kept for the next time they are met.
    cards_dirty: bool,
    /// The player entity you have selected: their sheet is sent again when a card update brings more.
    selected_entity: Option<u32>,
    cards_saved_ms: i64,
    /// When target info last had no believable combat power (logged once a minute, to fix the reader).
    target_unread: i64,
    legions: HashMap<u32, String>,
    /// Your entity in this zone (from your own record).
    self_entity: Option<u32>,
    pvp_seen: HashMap<(u32, u32), i64>,
}

fn pet_view(id: u32, pet: &Pet, name: Option<&str>, session: u32) -> Value {
    json!({
        "id": id,
        "name": name,
        "souls": pet.souls,
        "level": pet.level.unwrap_or(0),
        "levelEstimated": pet.level.is_none() || pet.level_estimated,
        "crystals": pet.crystals,
        "session": session,
    })
}

impl Tracker {
    pub fn new(store: Store, path: Option<PathBuf>, npcs: Arc<NpcLookup>, storage: Arc<DataStorage>, emit: Emit) -> Self {
        let cards = load_cards(path.as_ref().map(|p| p.with_file_name(CARDS_FILE)));
        let pvp_fights = pvp::Fights::load(path.as_ref().map(|p| p.with_file_name("pvp-fights.json")));
        Self {
            store,
            path,
            pets: data::pets(),
            npcs,
            storage,
            emit,
            sessions: HashMap::new(),
            mob_code: HashMap::new(),
            recent: VecDeque::new(),
            credits: VecDeque::new(),
            self_votes: HashMap::new(),
            last_combat: i64::MIN,
            pending_sync: None,
            pending_counters: None,
            pending_counter: Vec::new(),
            pending_abyss: None,
            abyss_balance: HashMap::new(),
            me_stats: None,
            field_bosses: None,
            field_bosses_unread: 0,
            boss_diagnostics: false,
            boss_messages: HashMap::new(),
            visible: HashMap::new(),
            world: None,
            position: None,
            position_ms: 0,
            position_exact: false,
            nearby_dirty: false,
            cubes: HashMap::new(),
            players: HashMap::new(),
            named: HashMap::new(),
            enemies: HashMap::new(),
            enemy_places: HashMap::new(),
            enemies_moved_ms: 0,
            cards,
            card_tick: 0,
            cards_dirty: false,
            selected_entity: None,
            cards_saved_ms: 0,
            pvp_hits: pvp::Hits::default(),
            classes: HashMap::new(),
            pvp_fights,
            target_unread: 0,
            legions: HashMap::new(),
            self_entity: None,
            pvp_seen: HashMap::new(),
        }
    }

    pub fn set_boss_diagnostics(&mut self, on: bool) {
        self.boss_diagnostics = on;
    }

    fn save(&self) {
        if let Some(path) = &self.path {
            if let Err(e) = self.store.save(path) {
                tracing::warn!("could not save the collection: {e}");
            }
        }
    }

    fn session(&self, pet: u32) -> u32 {
        let name = self.store.current.clone().unwrap_or_default();
        self.sessions.get(&name).and_then(|s| s.get(&pet)).copied().unwrap_or(0)
    }

    pub fn view(&self, id: u32) -> Value {
        let pet = self.store.pets().and_then(|p| p.get(&id)).cloned().unwrap_or_default();
        pet_view(id, &pet, self.store.name(id), self.session(id))
    }

    /// Every pet of the collection playing, as the overlay sees them.
    pub fn snapshot(&self) -> Value {
        Value::Array(self.store.pets().into_iter().flatten().map(|(&id, _)| self.view(id)).collect())
    }

    pub fn character(&self) -> Value {
        match &self.store.current {
            Some(name) => json!({ "name": name, "server": self.store.characters.get(name).and_then(|c| c.server) }),
            None => Value::Null,
        }
    }

    /// Which entity is you: the game's own word (the parser's), else the votes.
    fn me(&self) -> Option<u32> {
        self.storage
            .local_player_id()
            .map(|id| id as u32)
            .or(self.self_entity)
            .or_else(|| self.self_votes.iter().max_by_key(|(_, n)| **n).map(|(id, _)| *id))
    }

    fn npc_name(&self, code: u32) -> Option<String> {
        let name = self.npcs.get_npc_name(code as i32);
        (!name.is_empty() && name.parse::<i64>().is_err()).then_some(name)
    }

    /// Nothing is around you any more, and entity ids start over (the game closed).
    pub fn forget_view(&mut self) {
        self.visible.clear();
        self.mob_code.clear();
        self.credits.clear();
        self.recent.clear();
        self.self_votes.clear();
        self.players.clear();
        self.named.clear();
        self.classes.clear();
        self.legions.clear();
        self.self_entity = None;
        self.clear_cubes();
        self.world = None;
        self.position = None;
        self.position_exact = false;
        self.nearby_dirty = true;
    }

    /// The cubes in view, as the overlay shows them: where (the map data's x, -y), how high,
    /// and since when they exist.
    pub fn cubes(&self) -> Value {
        let mut list: Vec<&p::ObjectSpawn> = self.cubes.values().collect();
        list.sort_by_key(|c| c.id);
        Value::Array(
            list.into_iter()
                .map(|c| {
                    json!({
                        "id": c.id, "template": c.template, "position": [c.x.round() as i64, (-c.y).round() as i64],
                        "height": c.z.round() as i64, "createdAt": c.created_ms,
                    })
                })
                .collect(),
        )
    }

    fn cubes_changed(&self, ts: i64) {
        (self.emit)(json!({ "type": "cubes", "ts": ts, "cubes": self.cubes() }));
    }

    /// A player card read: kept, its combat power through `steady_cp`. An enemy in view it names
    /// gets the numbers on the list.
    fn player_card(&mut self, ts: i64, card: p::PlayerCard) {
        let entry = self.card_mut((card.name.clone(), card.server));
        entry.level = card.level;
        entry.gear_score = card.gear_score;
        entry.class = p::roster_class(card.class).or(entry.class);
        steady_cp(entry, card.combat_power);
        let shown = self.enemies.values().any(|e| e.name == card.name && e.server == Some(card.server));
        if shown {
            self.enemies_changed(ts);
        }
        self.refresh_selected(ts);
    }

    /// Write the cards when some changed and a minute has passed since the last write.
    fn save_cards(&mut self, ts: i64) {
        if !self.cards_dirty || ts - self.cards_saved_ms < CARDS_SAVE_EVERY_MS {
            return;
        }
        self.cards_dirty = false;
        self.cards_saved_ms = ts;
        let Some(path) = self.path.as_ref().map(|p| p.with_file_name(CARDS_FILE)) else { return };
        let list: Vec<SavedCard> = self
            .cards
            .iter()
            .filter(|(_, c)| c.cp.is_some() || c.level > 0 || c.class.is_some())
            .map(|((name, server), c)| SavedCard { name: name.clone(), server: *server, level: c.level, gear_score: c.gear_score, class: c.class.map(str::to_string), cp: c.cp })
            .collect();
        if let Err(e) = serde_json::to_string(&list).map_err(|e| e.to_string()).and_then(|s| std::fs::write(&path, s).map_err(|e| e.to_string())) {
            tracing::warn!("could not save the player cards: {e}");
        }
    }

    /// A player's card to update, made if new. Past `MAX_CARDS` the one updated longest ago makes
    /// room: a crowd (a city, a siege) never stops new players' cards being kept.
    fn card_mut(&mut self, key: (String, u16)) -> &mut Card {
        self.card_tick += 1;
        self.cards_dirty = true;
        if !self.cards.contains_key(&key) && self.cards.len() >= MAX_CARDS {
            if let Some(oldest) = self.cards.iter().min_by_key(|(_, c)| c.touched).map(|(k, _)| k.clone()) {
                self.cards.remove(&oldest);
            }
        }
        let tick = self.card_tick;
        let card = self.cards.entry(key).or_default();
        card.touched = tick;
        card
    }

    /// The combat power a player's spawn gives, onto their card. True when the shown value changed.
    fn spawn_combat_power(&mut self, player: &p::Player) -> bool {
        let (Some(cp), Some(server)) = (player.combat_power, player.server) else { return false };
        let card = self.card_mut((player.name.clone(), server));
        if card.class.is_none() {
            card.class = player.class.and_then(p::roster_class);
        }
        let before = card.cp;
        steady_cp(card, cp);
        card.cp != before
    }

    /// A player you targeted: their sheet. It goes on their card (the Enemies overlay shows it), and
    /// to the app as your target.
    fn target_info(&mut self, ts: i64, t: p::TargetInfo, raw: &[u8]) {
        if !CP_RANGE.contains(&t.combat_power) && ts - self.target_unread > 60_000 {
            self.target_unread = ts;
            let tail: String = raw.iter().rev().take(64).rev().map(|b| format!("{b:02x}")).collect();
            tracing::warn!("target info: no combat power read for {} ({}): tail {tail}", t.name, t.combat_power);
        }
        let card = self.card_mut((t.name.clone(), t.server));
        card.level = t.level;
        card.gear_score = t.gear_score;
        card.class = p::roster_class(t.class);
        steady_cp(card, t.combat_power);
        let cp = card.cp;
        let class = card.class;
        let open_pvp = self.players.values().any(|o| o.open_pvp && o.name == t.name && o.server == Some(t.server));
        let enemy = self.is_enemy(Some(t.server), None, open_pvp);
        (self.emit)(json!({
            "type": "target", "ts": ts, "name": t.name, "server": t.server, "level": t.level,
            "gearScore": t.gear_score, "combatPower": cp, "className": class, "legion": t.legion, "enemy": enemy,
        }));
        if self.enemies.values().any(|e| e.name == t.name && e.server == Some(t.server)) {
            self.enemies_changed(ts);
        }
    }

    /// The selected player's sheet again, after their card learned something.
    fn refresh_selected(&mut self, ts: i64) {
        if let Some(entity) = self.selected_entity {
            self.selected(ts, entity);
        }
    }

    /// You selected an entity (`35 38`): when it is a player we know, their sheet goes to the app at
    /// once, with what is known of them (spawn, card, legion, skills seen); an unknown value is null,
    /// never a 0. Anything else clears the last one.
    fn selected(&mut self, ts: i64, entity: u32) {
        self.selected_entity = None;
        let known = self
            .players
            .get(&entity)
            .map(|p| (p.name.clone(), p.server, p.legion.clone(), p.class.and_then(p::roster_class), p.pvp, p.open_pvp))
            .or_else(|| self.named.get(&entity).map(|(n, s, l)| (n.clone(), Some(*s), l.clone(), None, false, false)));
        let Some((name, server, legion, spawn_class, pvp, open_pvp)) = known else {
            (self.emit)(json!({ "type": "targetClear", "ts": ts }));
            return;
        };
        self.selected_entity = Some(entity);
        let card = server.and_then(|s| self.cards.get(&(name.clone(), s)));
        let class = card.and_then(|c| c.class).or(spawn_class).or_else(|| self.classes.get(&entity).copied());
        let enemy = self.is_enemy(server, None, open_pvp);
        let legion = legion.or_else(|| self.legions.get(&entity).cloned());
        (self.emit)(json!({
            "type": "target", "ts": ts, "entity": entity, "name": name, "server": server,
            "level": card.map(|c| c.level).filter(|&l| l > 0), "gearScore": card.map(|c| c.gear_score).filter(|&g| g > 0),
            "combatPower": card.and_then(|c| c.cp), "className": class, "legion": legion, "enemy": enemy,
            "pvp": pvp, "openPvp": open_pvp,
        }));
    }

    /// The hits in a `04 38`: a player's skill says their class, and those between you and another
    /// player are kept (`pvp`).
    fn damage(&mut self, ts: i64, frame: &[u8]) {
        // Nobody in view: no player's hit to read.
        if self.players.is_empty() {
            return;
        }
        let me = self.me();
        let storage = self.storage.clone();
        for h in damage::hits(frame, |v| storage.is_plausible_entity_id(v)) {
            if self.players.contains_key(&h.actor) || Some(h.actor) == me {
                if let Some(class) = pvp::skill_class(h.skill) {
                    let before = self.classes.insert(h.actor, class);
                    if let Some(said) = before.filter(|&b| b != class) {
                        let name = self.players.get(&h.actor).map_or("you", |p| p.name.as_str());
                        tracing::warn!("class check: {name}'s spawn record says {said}, their skills say {class}");
                    }
                    if before != Some(class) {
                        self.class_learnt(ts, h.actor);
                    }
                }
            }
            // A hit of a player on another, you or not: a fight's, should it end in a kill.
            let player = |e: u32| Some(e) == me || self.players.contains_key(&e);
            if h.actor == h.target || !player(h.actor) || !player(h.target) {
                continue;
            }
            let has = |s: SpecialDamage| h.specials.contains(&s);
            self.pvp_hits.push(pvp::Hit {
                ts,
                actor: h.actor,
                target: h.target,
                skill: h.skill,
                damage: h.damage,
                crit: h.crit,
                dot: false,
                back: has(SpecialDamage::Back),
                perfect: has(SpecialDamage::Perfect),
                double: has(SpecialDamage::Double),
                parry: has(SpecialDamage::Parry),
                multi: u32::try_from(h.multi_hit_count).unwrap_or(0),
            });
        }
    }

    /// A player's class, newly read from their skills: the enemies' list shows it. Where their
    /// card says another (its class number, `p::roster_class`), the log says so: that table is
    /// A2Tools' from 14 players, and this is how the rest of it gets checked.
    fn class_learnt(&mut self, ts: i64, entity: u32) {
        if let Some(player) = self.players.get(&entity) {
            let card = player.server.and_then(|s| self.cards.get(&(player.name.clone(), s))).and_then(|c| c.class);
            let skills = self.classes.get(&entity).copied();
            if let (Some(card), Some(skills)) = (card, skills) {
                if card != skills {
                    tracing::warn!("class check: {}'s card says {card}, their skills say {skills}", player.name);
                }
            }
        }
        if self.enemies.contains_key(&entity) {
            self.enemies_changed(ts);
        }
    }

    /// A player's class: their card's, else the one their skills say.
    fn class_of(&self, entity: Option<u32>, name: &str, server: Option<u16>) -> Option<&'static str> {
        let card = server.and_then(|s| self.cards.get(&(name.to_string(), s))).and_then(|c| c.class);
        card.or_else(|| entity.and_then(|e| self.classes.get(&e).copied()))
    }

    /// A player's combat power, as their card shows it.
    fn combat_power_of(&self, name: &str, server: Option<u16>) -> Option<u32> {
        server.and_then(|s| self.cards.get(&(name.to_string(), s))).and_then(|c| c.cp)
    }

    pub fn finish_writes(&mut self) {
        self.pvp_fights.finish();
    }

    /// A saved PvP fight, by id.
    pub fn pvp_fight(&self, id: &str) -> Option<pvp::Fight> {
        self.pvp_fights.get(id).cloned()
    }

    /// One side of a PvP fight: what is known of that player.
    fn pvp_side(&self, entity: u32, name: &str, server: Option<u16>, legion: Option<String>) -> pvp::Side {
        let card = server.and_then(|s| self.cards.get(&(name.to_string(), s)));
        pvp::Side {
            entity,
            name: name.to_string(),
            server,
            class_name: card.and_then(|c| c.class).or_else(|| self.classes.get(&entity).copied()).map(str::to_string),
            combat_power: card.and_then(|c| c.cp),
            legion,
        }
    }

    /// A kill you took part in: the fight with that player, saved from your hits on each other.
    /// Your kill, your death, or someone else's kill of a player you were fighting (an assist: the
    /// fight with the victim). None when you two exchanged no hits (a kill you only saw).
    fn save_pvp_fight(&mut self, ts: i64, credit: &p::KillCredit, mine: bool, died: bool, my_legion: Option<String>, my_server: Option<u16>) -> Option<String> {
        let me = self.me()?;
        let my_name = self.store.current.clone()?;
        let opponent = if died { credit.killer } else { credit.victim };
        if opponent == me {
            return None;
        }
        // A fight you took part in: hits between you two. Then all of it: everyone's on either of you, and yours and theirs on anyone.
        if self.pvp_hits.between(me, opponent, ts).is_empty() {
            return None;
        }
        // Everyone's hits on either of you, and yours and theirs on anyone: your own log in it too.
        let hits = self.pvp_hits.around_any(&[me, opponent], ts);
        let them = if died {
            self.pvp_side(opponent, &credit.name, Some(credit.server), credit.legion.clone().or_else(|| self.legions.get(&opponent).cloned()))
        } else {
            let v = self.players.get(&opponent)?.clone();
            self.pvp_side(opponent, &v.name, v.server, v.legion.or_else(|| self.legions.get(&opponent).cloned()))
        };
        let me_side = self.pvp_side(me, &my_name, my_server, my_legion);
        let id = format!("pvp-{ts}-{opponent}");
        let outcome = if died { "death" } else if mine { "kill" } else { "assist" };
        let mut others: Vec<u32> = hits.iter().flat_map(|h| [h.actor, h.target]).filter(|&e| e != me && e != opponent).collect();
        others.sort_unstable();
        others.dedup();
        let others: Vec<pvp::Side> = others
            .into_iter()
            .filter_map(|e| {
                let p = self.players.get(&e)?.clone();
                Some(self.pvp_side(e, &p.name, p.server, p.legion.or_else(|| self.legions.get(&e).cloned())))
            })
            .collect();
        let mut fight = pvp::fight(id.clone(), ts, outcome, me_side, them, &hits);
        fight.others = others;
        if outcome == "assist" {
            fight.killer = Some(credit.name.clone());
        }
        tracing::info!("pvp fight saved: {} vs {} ({}, {} hits, {} other players)", fight.me.name, fight.opponent.name, fight.outcome, hits.len(), fight.others.len());
        self.pvp_fights.add(fight);
        Some(id)
    }

    /// Your faction, from the server of the character playing.
    /// The server of the character playing.
    fn my_server(&self) -> Option<u16> {
        let name = self.store.current.as_ref()?;
        self.store.characters.get(name)?.server
    }

    /// Whether a player can be fought: of the other faction, or (since the 2026-11 update) of yours
    /// but another server where everyone fights (the Abyss matches servers of one faction against
    /// each other: AlvaroDust 1401 against 1406, the owner's 2026-11-25 log).
    fn is_enemy(&self, server: Option<u16>, faction: Option<u8>, open_pvp: bool) -> bool {
        let theirs = faction.or_else(|| server.and_then(p::server_faction));
        match (theirs, self.my_faction()) {
            (Some(theirs), Some(mine)) if theirs != mine => true,
            (Some(_), Some(_)) => open_pvp && matches!((server, self.my_server()), (Some(s), Some(m)) if s != m),
            _ => false,
        }
    }

    fn my_faction(&self) -> Option<u8> {
        let name = self.store.current.as_ref()?;
        self.store.characters.get(name)?.server.and_then(p::server_faction)
    }

    fn enemies_changed(&self, ts: i64) {
        let mut list: Vec<&p::Player> = self.enemies.values().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        let players: Vec<Value> =
            list.iter()
                .map(|e| {
                    let card = e.server.and_then(|s| self.cards.get(&(e.name.clone(), s)));
                    let position = self.enemy_places.get(&e.entity).map(|&(x, y)| [x.round() as i64, (-y).round() as i64]);
                    json!({
                        "position": position,
                        "entity": e.entity, "name": e.name, "server": e.server, "legion": e.legion, "pvp": e.pvp, "openPvp": e.open_pvp,
                        "level": card.map(|c| c.level).filter(|&l| l > 0), "gearScore": card.map(|c| c.gear_score).filter(|&g| g > 0), "combatPower": card.and_then(|c| c.cp),
                        "className": card.and_then(|c| c.class).or_else(|| self.classes.get(&e.entity).copied()),
                    })
                })
                .collect();
        (self.emit)(json!({ "type": "enemies", "ts": ts, "players": players }));
    }

    /// An enemy seen standing at game (x, y): their pin on the map moves (once a second at most).
    fn enemy_moved(&mut self, ts: i64, entity: u32, x: f32, y: f32) {
        if !self.enemies.contains_key(&entity) {
            return;
        }
        self.enemy_places.insert(entity, (x, y));
        if ts - self.enemies_moved_ms >= ENEMY_MOVE_EVERY_MS {
            self.enemies_moved_ms = ts;
            self.enemies_changed(ts);
        }
    }

    fn clear_enemies(&mut self, ts: i64) {
        self.enemy_places.clear();
        if !self.enemies.is_empty() {
            self.enemies.clear();
            self.enemies_changed(ts);
        }
    }

    fn clear_cubes(&mut self) {
        if !self.cubes.is_empty() {
            self.cubes.clear();
            (self.emit)(json!({ "type": "cubes", "cubes": [] }));
        }
    }

    /// You are at game (x, y): kept as the map data's (x, -y).
    fn move_to(&mut self, ts: i64, x: f32, y: f32, exact: bool) {
        self.position = Some((x, -y));
        self.position_ms = ts;
        self.position_exact = exact;
        self.nearby_dirty = true;
    }

    /// Game (x, y) is too far from your last place for the time since: a misread.
    fn jump(&self, ts: i64, x: f32, y: f32) -> bool {
        let dt = ts - self.position_ms;
        let Some((px, py)) = self.position else { return false };
        dt < MAX_JUMP_MS && ((px - x).hypot(py + y)) > MAX_SPEED * (dt.max(50) as f32 / 1000.0)
    }

    pub fn nearby(&mut self) -> Value {
        self.nearby_dirty = false;
        let mut counts: HashMap<u32, u32> = HashMap::new();
        for code in self.visible.values() {
            *counts.entry(*code).or_default() += 1;
        }
        let mut monsters: Vec<(u32, u32)> = counts.into_iter().collect();
        monsters.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        json!({
            "world": self.world,
            "position": self.position.map(|(x, y)| [x.round() as i64, y.round() as i64]),
            "monsters": monsters.into_iter().map(|(npc, count)| json!({ "npc": npc, "count": count })).collect::<Vec<_>>(),
        })
    }

    pub fn reset_session(&mut self) {
        let name = self.store.current.clone().unwrap_or_default();
        self.sessions.remove(&name);
    }

    pub fn set_souls(&mut self, id: u32, souls: u32) -> Value {
        self.store.pets_mut().entry(id).or_default().souls = souls;
        self.save();
        self.view(id)
    }

    pub fn set_name(&mut self, id: u32, name: &str) -> Value {
        // A name given by hand outvotes any learned one.
        self.store.names.insert(id, [(name.to_string(), 1_000_000)].into());
        self.save();
        self.view(id)
    }

    /// One game frame, as the parser read it; `ts` is its capture time (ms).
    pub fn frame(&mut self, ts: i64, f: &[u8]) {
        self.save_cards(ts);
        if let Some((at, _)) = &self.pending_sync {
            if ts - at > SYNC_WAIT_MS {
                let (_, coll) = self.pending_sync.take().unwrap();
                self.sync(ts, &coll);
            }
        }
        // Counters with no character record after them (not a login): the character playing.
        if self.pending_counters.as_ref().is_some_and(|(at, _)| ts - at > COUNTERS_WAIT_MS) {
            if let Some(name) = self.store.current.clone() {
                let server = self.store.characters.get(&name).and_then(|c| c.server);
                self.counters_read(&name, server);
            }
            self.pending_counters = None;
            self.pending_counter.clear();
        }
        if self.pending_abyss.is_some_and(|(at, _, _)| ts - at > ABYSS_WAIT_MS) {
            let name = self.store.current.clone();
            self.abyss_read(name);
        }
        let Some(op) = p::opcode(f) else { return };
        // Looking for where else the game sends field bosses (the map's list comes at login, but
        // not always with the map open): any other message naming two of them is logged, once a
        // minute for each kind, with its bytes.
        if self.boss_diagnostics
            && op != p::OP_FIELD_BOSSES
            && f.len() <= 8192
            && self.boss_messages.get(&op).is_none_or(|&last| ts - last > 60_000)
            && p::boss_ids_in(f) >= 2
        {
            self.boss_messages.insert(op, ts);
            let hex: String = f.iter().take(600).map(|b| format!("{b:02x}")).collect();
            tracing::info!("field bosses in message {:02x} {:02x} ({} bytes): {hex}", op[0], op[1], f.len());
        }

        for credit in p::kill_credits(f) {
            self.kill_credit(ts, &credit);
        }
        match op {
            p::OP_SPAWN => {
                if let Some(s) = p::spawn(f) {
                    match s.mob_code {
                        Some(code) => {
                            self.mob_code.insert(s.entity, code);
                            self.visible.insert(s.entity, code);
                            self.nearby_dirty = true;
                        }
                        None => {
                            self.mob_code.remove(&s.entity);
                        }
                    }
                }
            }
            p::OP_OBJECT_SPAWN => {
                if let Some(o) = p::object_spawn(f) {
                    if CUBE_TEMPLATES.contains(&o.template) && self.cubes.insert(o.id, o).is_none() {
                        tracing::info!("hidden cube {} (template {}) at {:.0}, {:.0}", o.id, o.template, o.x, o.y);
                        self.cubes_changed(ts);
                    }
                }
            }
            p::OP_OBJECT_REMOVED => {
                // Opened (04) or out of range (01): either way not there for you any more.
                if let Some((id, reason)) = p::object_removed(f) {
                    if self.cubes.remove(&id).is_some() {
                        tracing::info!("hidden cube {id} gone (reason {reason})");
                        self.cubes_changed(ts);
                    }
                }
            }
            p::OP_DEATH => {
                if let Some((entity, flag)) = p::death(f) {
                    // Any 42 36 takes a monster out of view: 1 out of range, 3 killed, 7 gone.
                    if self.visible.remove(&entity).is_some() {
                        self.nearby_dirty = true;
                    }
                    // A player too: an enemy gone from view (or dead) is off the list.
                    if self.enemies.remove(&entity).is_some() {
                        self.enemies_changed(ts);
                    }
                    if flag == p::DEATH_FLAG_COMBAT && self.mob_code.contains_key(&entity) {
                        self.push_recent(ts, entity);
                        let code = self.mob_code[&entity];
                        if FIELD_BOSS_NPCS.contains(&code) {
                            tracing::info!("field boss {code} killed in view");
                            (self.emit)(json!({ "type": "bossKilled", "ts": ts, "npc": code }));
                        }
                    }
                }
            }
            p::OP_MAP_LOAD => {
                if let Some((world, x, y)) = p::map_load(f) {
                    // A new zone: nothing from the last one is around you any more.
                    // Another zone: its cubes are not around you. The same zone again
                    // (a teleport inside it) keeps them; the server removes what is out of range.
                    if self.world != Some(world) {
                        self.clear_cubes();
                    }
                    self.world = Some(world);
                    self.move_to(ts, x, y, true);
                    self.visible.clear();
                    self.players.clear();
                    self.named.clear();
                    self.classes.clear();
                    self.legions.clear();
                    self.clear_enemies(ts);
                    self.nearby_dirty = true;
                }
            }
            p::OP_TELEPORT => {
                if let Some((x, y)) = p::self_teleport(f) {
                    self.move_to(ts, x, y, true);
                }
            }
            op if p::OP_EFFECTS.contains(&op) => {
                // Effects on you, whoever put them there: where you are, between zone loads. On an
                // enemy: where they are.
                if let Some((target, x, y)) = p::effect_position(f) {
                    self.enemy_moved(ts, target, x, y);
                    if Some(target) == self.me() && !self.jump(ts, x, y) {
                        self.move_to(ts, x, y, true);
                    }
                }
            }
            op if p::OP_CASTS.contains(&op) => {
                // Your casts give where their target is: only a guess at where you
                // are, taken when nothing better is known or it is far from it.
                if let Some((actor, x, y)) = p::cast(f) {
                    // A cast's place is its target's: an enemy's, when they are the target.
                    if let Some(target) = p::cast_target(f) {
                        self.enemy_moved(ts, target, x, y);
                    }
                    let near = self.position.is_some_and(|(px, py)| (px - x).hypot(py + y) <= CAST_RANGE);
                    if Some(actor) == self.me() && !(self.position_exact && near) && !self.jump(ts, x, y) {
                        self.move_to(ts, x, y, false);
                    }
                }
            }
            p::OP_SELF => {
                if let Some(who) = p::character(f) {
                    self.self_entity = Some(who.entity);
                    self.character_seen(ts, who);
                }
            }
            p::OP_SOUL => {
                if let Some(list) = p::souls(f) {
                    self.souls(ts, &list);
                }
            }
            p::OP_LEVEL_UP => {
                if let Some((pet, level)) = p::level_up(f) {
                    self.level_up(pet, level);
                }
            }
            p::OP_PET_UNLOCKED => {
                if let Some((pet, level)) = p::pet_unlocked(f) {
                    self.pet_unlocked(pet, level);
                }
            }
            p::OP_CRYSTAL => {
                if let Some(c) = p::crystal(f) {
                    self.crystal(ts, &c);
                }
            }
            p::OP_COLLECTION => {
                if let Some(coll) = p::collection(f) {
                    self.pending_sync = Some((ts, coll));
                }
            }
            p::OP_ITEM => {
                if let Some(balance) = p::abyss_balance(f) {
                    self.abyss_wallet(ts, balance);
                }
                if let Some(balance) = p::kina(f) {
                    // The balance as is: the app works out what was earned from the changes.
                    (self.emit)(json!({ "type": "kina", "ts": ts, "balance": balance }));
                }
            }
            p::OP_FIELD_BOSSES => match p::field_bosses(f) {
                Some(list) => {
                    if self.field_bosses.as_ref() != Some(&list) {
                        (self.emit)(json!({
                            "type": "fieldBosses", "ts": ts, "world": list.0,
                            "bosses": list.1.iter().map(|b| json!({ "id": b.id, "up": b.up, "at": b.at_ms })).collect::<Vec<_>>(),
                        }));
                        self.field_bosses = Some(list);
                    }
                }
                // The map's list, in a shape the parser does not know (a patch): its bytes, to fix it.
                None if ts - self.field_bosses_unread > 60_000 => {
                    self.field_bosses_unread = ts;
                    let hex: String = f.iter().take(600).map(|b| format!("{b:02x}")).collect();
                    tracing::warn!("field boss list not read ({} bytes): {hex}", f.len());
                }
                None => {}
            },
            p::OP_SHOP => {
                if let Some((tab, items, next)) = p::shop(f) {
                    // As the tab shows it: the app knows which items are pets worth buying.
                    (self.emit)(json!({ "type": "shop", "ts": ts, "tab": tab, "nextAt": next, "items": items }));
                }
            }
            damage::OP_DAMAGE => self.damage(ts, f),
            p::OP_CHARACTER_LIST => {
                if let Some(list) = p::character_list(f) {
                    let characters: Vec<_> = list
                        .iter()
                        .map(|c| {
                            json!({
                                // As text: NCSoft's keys are past what a JS number holds.
                                "key": c.key.to_string(), "name": c.name, "server": c.server, "classId": c.class,
                                "className": p::roster_class(c.class), "level": c.level, "gearScore": c.gear_score, "legion": c.legion,
                            })
                        })
                        .collect();
                    tracing::info!("character list: {}", list.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(", "));
                    (self.emit)(json!({ "type": "characterList", "ts": ts, "characters": characters }));
                }
            }
            p::OP_COUNTERS => {
                if let Some(list) = p::counters(f) {
                    self.pending_counters = Some((ts, list));
                }
            }
            p::OP_ABYSS_POINTS => {
                if let Some((points, limit)) = p::abyss_points(f) {
                    // One still waiting: no login followed it, it was the character playing's.
                    if self.pending_abyss.is_some() {
                        let name = self.store.current.clone();
                        self.abyss_read(name);
                    }
                    self.pending_abyss = Some((ts, points, limit));
                }
            }
            p::OP_COUNTER => {
                if let Some((id, values)) = p::counter(f) {
                    if self.pending_counters.is_some() {
                        self.pending_counter.push((ts, id, values));
                    } else if let Some(name) = self.store.current.clone() {
                        let server = self.store.characters.get(&name).and_then(|c| c.server);
                        (self.emit)(json!({ "type": "counter", "ts": ts, "name": name, "server": server, "id": id.to_string(), "values": values }));
                    }
                }
            }
            p::OP_PVP_SWITCH => {
                if let Some((entity, on)) = p::pvp_switch(f) {
                    if let Some(player) = self.players.get_mut(&entity) {
                        player.pvp = on;
                    }
                    if let Some(enemy) = self.enemies.get_mut(&entity).filter(|e| e.pvp != on) {
                        enemy.pvp = on;
                        self.enemies_changed(ts);
                    }
                }
            }
            p::OP_PLAYER_GONE => {
                // Out of view: off the enemies' list (kept among the players, for names on a late
                // kill credit; a new zone clears those).
                if let Some(entity) = p::player_gone(f) {
                    self.enemy_places.remove(&entity);
                    if self.enemies.remove(&entity).is_some() {
                        self.enemies_changed(ts);
                    }
                }
            }
            p::OP_TARGET_INFO => {
                if let Some(t) = p::target_info(f) {
                    self.target_info(ts, t, f);
                } else if ts - self.target_unread > 60_000 {
                    self.target_unread = ts;
                    let head: String = f.iter().take(64).map(|b| format!("{b:02x}")).collect();
                    tracing::warn!("target info not read ({} bytes): head {head}", f.len());
                }
            }
            p::OP_SELECTION => {
                if let Some(entity) = p::selection(f) {
                    self.selected(ts, entity);
                }
            }
            p::OP_PLAYER_CARD => {
                if let Some(card) = p::player_card(f) {
                    self.player_card(ts, card);
                }
            }
            p::OP_APPLICANT => {
                if let Some((character, card)) = p::applicant(f) {
                    (self.emit)(json!({
                        "type": "applicant", "ts": ts, "character": character, "name": card.name, "server": card.server,
                        "className": p::roster_class(card.class), "level": card.level, "gearScore": card.gear_score, "combatPower": card.combat_power,
                    }));
                }
            }
            p::OP_APPLICANT_GONE => {
                if let Some(character) = p::applicant_gone(f) {
                    (self.emit)(json!({ "type": "applicantGone", "ts": ts, "character": character }));
                }
            }
            p::OP_MEMBER_JOINED => {
                if let Some(character) = p::member_joined(f) {
                    (self.emit)(json!({ "type": "applicantGone", "ts": ts, "character": character }));
                }
            }
            p::OP_PLAYER => {
                if let Some(player) = p::player(f) {
                    let enemy = self.is_enemy(player.server, player.faction, player.open_pvp);
                    if let Some(class) = player.class.and_then(p::roster_class) {
                        self.classes.entry(player.entity).or_insert(class);
                    }
                    if let (true, Some(place)) = (enemy, player.place) {
                        self.enemy_places.insert(player.entity, place);
                    }
                    let cp_changed = self.spawn_combat_power(&player);
                    self.players.insert(player.entity, player.clone());
                    if cp_changed {
                        self.refresh_selected(ts);
                    }
                    if enemy {
                        match self.enemies.insert(player.entity, player.clone()) {
                            None => {
                                tracing::info!("enemy in view: {} ({:?}, {:?} combat power, pvp {})", player.name, player.server, player.combat_power, player.pvp);
                                self.enemies_changed(ts);
                            }
                            Some(before) if cp_changed || (before.pvp, before.open_pvp) != (player.pvp, player.open_pvp) => self.enemies_changed(ts),
                            Some(_) => {}
                        }
                    }
                    self.players.insert(player.entity, player);
                }
            }
            p::OP_LEGION => {
                if let Some((entity, name)) = p::legion(f) {
                    if Some(entity) == self.me() {
                        self.my_legion(&name);
                    }
                    self.legions.insert(entity, name);
                }
            }
            _ => {}
        }
    }

    fn push_recent(&mut self, ts: i64, mob: u32) {
        self.recent.push_back((ts, mob));
        if self.recent.len() > 64 {
            self.recent.pop_front();
        }
    }

    fn kill_credit(&mut self, ts: i64, credit: &p::KillCredit) {
        if self.mob_code.contains_key(&credit.victim) {
            self.push_recent(ts, credit.victim);
            self.credits.push_back((ts, credit.victim, credit.killer));
            if self.credits.len() > 32 {
                self.credits.pop_front();
            }
        }
        // Your kills (anyone's until it is known which player you are): fighting is going on.
        let me = self.me();
        if (me.is_none() || me == Some(credit.killer)) && ts - self.last_combat >= COMBAT_EVERY_MS {
            self.last_combat = ts;
            (self.emit)(json!({ "type": "combat", "ts": ts }));
        }
        if (1000..=9999).contains(&credit.server) && self.named.len() < 2000 {
            self.named.insert(credit.killer, (credit.name.clone(), credit.server, credit.legion.clone()));
        }
        if credit.player_victim && (1000..=9999).contains(&credit.server) {
            self.pvp_kill(ts, credit);
            // Dead: not a threat until they come back (a new `45 36` lists them again).
            if self.enemies.remove(&credit.victim).is_some() {
                self.enemies_changed(ts);
            }
        }
    }

    /// A character entered the world. Collections are per server: a character
    /// on another server than the last one plays that server's collection.
    fn character_seen(&mut self, ts: i64, who: p::Character) {
        let old_key = self.store.key();
        let old = self.store.current.replace(who.name.clone());
        self.store.characters.entry(who.name.clone()).or_default().server = Some(who.server);
        self.store.adopt_unknown();
        let changed = old.as_deref() != Some(who.name.as_str()) || old_key != self.store.key();
        if changed {
            // Another character, maybe on the other side: who counts as an enemy changes.
            self.clear_enemies(ts);
            // The last character's Hidden Cubes are not this one's (the same zone keeps them otherwise).
            self.clear_cubes();
            self.save();
            tracing::info!("character: {} on {}{}", who.name, who.server, old.as_ref().map(|o| format!(" (was {o})")).unwrap_or_default());
            (self.emit)(json!({
                "type": "character", "ts": ts, "name": who.name, "server": who.server,
                "switched": old.is_some(), "pets": self.snapshot(),
            }));
        }
        if let (Some(class), Some(level), Some(gear_score)) = (who.class, who.level, who.gear_score) {
            let stats = (who.name.clone(), class, level, gear_score);
            if self.me_stats.as_ref() != Some(&stats) {
                (self.emit)(json!({
                    "type": "me", "ts": ts, "name": who.name, "server": who.server, "classId": class,
                    "className": p::roster_class(class), "level": level, "gearScore": gear_score,
                }));
                self.me_stats = Some(stats);
            }
        }
        if self.pending_counters.is_some() {
            self.counters_read(&who.name, Some(who.server));
        }
        if let Some((_, coll)) = self.pending_sync.take() {
            self.sync(ts, &coll);
        }
        if self.pending_abyss.is_some() {
            self.abyss_read(Some(who.name));
        }
    }

    /// The Abyss Points total waiting, as `name`'s: what it gained over that character's last
    /// total. The first known total, a lower one (the weekly reset) or a jump past ABYSS_MAX_GAIN
    /// is only a new start.
    fn abyss_read(&mut self, name: Option<String>) {
        let Some((ts, points, limit)) = self.pending_abyss.take() else { return };
        let gained = match &name {
            Some(name) => {
                let entry = self.store.characters.entry(name.clone()).or_default();
                let gained = entry.abyss_points.map_or(0, |last| points.saturating_sub(last));
                let gained = if gained > ABYSS_MAX_GAIN { 0 } else { gained };
                if entry.abyss_points != Some(points) {
                    entry.abyss_points = Some(points);
                    self.save();
                }
                gained
            }
            None => 0,
        };
        if gained > 0 {
            tracing::debug!("abyss points: +{gained} ({points} of {limit})");
        }
        (self.emit)(json!({ "type": "abyss", "ts": ts, "name": name, "points": points, "limit": limit, "gained": gained }));
    }

    /// The Abyss Points balance (`1b 56`): each rise is a gain, by character. The first balance seen
    /// is only a start, and a jump past ABYSS_MAX_GAIN (a mailbox, a quest chest) is not farming.
    fn abyss_wallet(&mut self, ts: i64, balance: u64) {
        let Some(name) = self.store.current.clone() else { return };
        let before = self.abyss_balance.insert(name.clone(), balance);
        let gained = before.map_or(0, |b| balance.saturating_sub(b));
        if gained > 0 && gained <= ABYSS_MAX_GAIN {
            (self.emit)(json!({ "type": "abyssGain", "ts": ts, "name": name, "gained": gained, "balance": balance }));
        }
    }

    /// The login's counters, for `name`: by id, their values (the app knows which is which).
    fn counters_read(&mut self, name: &str, server: Option<u16>) {
        let Some((at, list)) = self.pending_counters.take() else { return };
        let values: serde_json::Map<String, Value> = list.into_iter().map(|(id, v)| (id.to_string(), json!(v))).collect();
        // When the game sent them: the changes since come after.
        (self.emit)(json!({ "type": "counters", "ts": at, "name": name, "server": server, "values": values }));
        for (ts, id, values) in std::mem::take(&mut self.pending_counter) {
            (self.emit)(json!({ "type": "counter", "ts": ts, "name": name, "server": server, "id": id.to_string(), "values": values }));
        }
    }

    /// Entering the world sends the whole collection: the server's numbers for every pet.
    fn sync(&mut self, ts: i64, coll: &p::Collection) {
        let levels: HashMap<u32, u32> = coll.levels.iter().copied().collect();
        let souls: HashMap<u32, u32> = coll.souls.iter().copied().collect();
        let mut corrected = Vec::new();
        let mut ids: Vec<u32> = levels.keys().chain(souls.keys()).copied().collect();
        ids.sort_unstable();
        ids.dedup();
        for id in ids {
            let name = self.store.name(id).map(str::to_string);
            let pet = self.store.pets_mut().entry(id).or_default();
            let now = souls.get(&id).copied().unwrap_or(0);
            if pet.souls != now && (pet.souls > 0 || name.is_some()) {
                corrected.push(json!({ "id": id, "name": name, "before": pet.souls, "after": now }));
            }
            pet.souls = now;
            if let Some(&level) = levels.get(&id) {
                pet.level = Some(level);
                pet.level_estimated = false;
            }
        }
        self.save();
        tracing::info!("login sync: {} pets, {} souls", souls.len(), souls.values().sum::<u32>());
        (self.emit)(json!({
            "type": "sync", "ts": ts, "pets": souls.len(), "souls": souls.values().sum::<u32>(),
            "corrected": corrected, "collection": self.snapshot(),
        }));
    }

    fn souls(&mut self, ts: i64, list: &[(u32, u32)]) {
        // The kill just before (its credit comes ~0.3 s before the souls) names
        // the pet's monster; only when the souls are one pet's, so two pets
        // never take each other's monster.
        let kill = self.recent.iter().filter(|(t, _)| (0..=NAME_WINDOW_MS).contains(&(ts - t))).max_by_key(|(t, _)| *t);
        let kill_name = match (list.len(), kill) {
            (1, Some((_, mob))) => self.mob_code.get(mob).and_then(|code| self.npc_name(*code)),
            _ => None,
        };
        // Whoever was credited with the kill just before is (most often) you.
        let credited = self.credits.iter().filter(|(t, _, _)| (0..=NAME_WINDOW_MS).contains(&(ts - t))).max_by_key(|(t, _, _)| *t);
        if let Some((_, _, owner)) = credited {
            *self.self_votes.entry(*owner).or_default() += 1;
        }
        let name = self.store.current.clone().unwrap_or_default();
        for &(id, amount) in list {
            let pet = self.store.pets_mut().entry(id).or_default();
            pet.souls += amount;
            // Past its level's need the pet goes up a level, and the game takes
            // that level's cost from its count: the souls past it stay (24 + 5 at
            // a cost of 25 leaves 4, A2Tools pet-souls 0.5.4, 2026-11-05).
            let was = match pet.level {
                Some(level) => level,
                None => {
                    pet.level_estimated = true;
                    0
                }
            };
            let mut level = was;
            while level < MAX_LEVEL && pet.souls >= LEVEL_NEED[level as usize] {
                pet.souls -= LEVEL_NEED[level as usize];
                level += 1;
            }
            pet.level = Some(level);
            let levelled = level > was;
            if let Some(kill_name) = &kill_name {
                self.store.vote(id, kill_name, 1);
            }
            *self.sessions.entry(name.clone()).or_default().entry(id).or_default() += amount;
            (self.emit)(json!({ "type": "soul", "ts": ts, "amount": amount, "pet": self.view(id), "levelUp": levelled }));
        }
        self.save();
    }

    /// The game says a pet reached a level. Already there from its souls: the
    /// souls picked up since stay. Behind: it takes the level, and the game
    /// takes the cost of each level skipped from its souls (Karnif: 25 -> 0,
    /// 29 -> 4).
    fn level_up(&mut self, id: u32, level: u32) {
        let pet = self.store.pets_mut().entry(id).or_default();
        let was = pet.level.unwrap_or(0);
        if was >= level {
            pet.level_estimated = false;
            return;
        }
        let cost: u32 = LEVEL_NEED[was as usize..level as usize].iter().sum();
        pet.level = Some(level);
        pet.level_estimated = false;
        pet.souls = pet.souls.saturating_sub(cost);
        self.save();
        tracing::info!("level up: pet {id} is Lv{level} (from the game)");
        (self.emit)(json!({ "type": "pet", "pet": self.view(id) }));
    }

    /// A pet is yours now (a chest's, `09 90`), at `level`, with the souls it
    /// already had. Before, it showed as not had until the next login.
    fn pet_unlocked(&mut self, id: u32, level: u32) {
        let pet = self.store.pets_mut().entry(id).or_default();
        if pet.level.is_some_and(|was| was >= level) {
            pet.level_estimated = false;
            return;
        }
        pet.level = Some(level);
        pet.level_estimated = false;
        self.save();
        tracing::info!("pet unlocked: pet {id} at Lv{level}");
        (self.emit)(json!({ "type": "pet", "pet": self.view(id) }));
    }

    fn maxed(&self, id: u32) -> bool {
        self.store.pets().and_then(|p| p.get(&id)).and_then(|p| p.level).unwrap_or(0) >= MAX_LEVEL
    }

    /// Genus crystals, from a monster whose pet is maxed. The message names no
    /// pet, so it is the pet of a monster killed just before (yours if it is
    /// known which player you are), of the crystal's genus. Among those:
    /// - a pet already at Lv3 is it: the nearest such kill;
    /// - else, if they are all one pet's monsters, that pet is at Lv3 in game
    ///   whatever was saved (souls missed): it is corrected and credited;
    /// - else no one: two pets that could both be it.
    fn crystal(&mut self, ts: i64, crystal: &p::Crystal) {
        let genus = p::crystal_genus(crystal.genus);
        let credited: Vec<(i64, u32, u32)> =
            self.credits.iter().filter(|(t, _, _)| (0..=NAME_WINDOW_MS).contains(&(ts - t))).map(|&(t, m, o)| (ts - t, m, o)).collect();
        let me = self.me();
        let mine: Vec<_> = credited.iter().filter(|c| Some(c.2) == me).copied().collect();
        let kills = if mine.is_empty() { credited } else { mine };
        // (ms before, monster code, pet) for each kill whose monster drops a pet of this genus.
        let mut candidates: Vec<(i64, u32, u32)> = kills
            .iter()
            .filter_map(|&(ago, mob, _)| {
                let code = *self.mob_code.get(&mob)?;
                let pet = *self.pets.droppers.get(&code)?;
                let pet_genus = self.pets.genus.get(&pet).map(String::as_str);
                (genus.is_none() || pet_genus.is_none() || pet_genus == genus).then_some((ago, code, pet))
            })
            // A pet the game said is below Lv3 (login sync, its level up) still gets souls, not
            // crystals: it is not this crystal's, however near its monster died.
            .filter(|&(_, _, pet)| {
                let known = self.store.pets().and_then(|p| p.get(&pet)).filter(|p| p.level.is_some() && !p.level_estimated);
                known.is_none_or(|p| p.level >= Some(MAX_LEVEL))
            })
            .collect();
        candidates.sort();
        let maxed: Vec<_> = candidates.iter().filter(|c| self.maxed(c.2)).copied().collect();
        let (pick, corrected) = if let Some(&first) = maxed.first() {
            (Some(first), false)
        } else if !candidates.is_empty() && candidates.iter().all(|c| c.2 == candidates[0].2) {
            (Some(candidates[0]), true)
        } else {
            (None, false)
        };
        let raw = crystal.raw.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" ");
        let mut event = json!({
            "type": "crystal", "ts": ts, "amount": crystal.amount, "genus": genus,
            "npc": pick.map(|p| p.1), "raw": raw, "pet": null, "levelCorrected": false, "kills": [],
        });
        match pick {
            Some((_, code, id)) => {
                let name = self.npc_name(code);
                let pet = self.store.pets_mut().entry(id).or_default();
                if corrected {
                    pet.level = Some(MAX_LEVEL);
                    pet.souls = 0;
                    pet.level_estimated = false;
                    event["levelCorrected"] = json!(true);
                }
                pet.crystals += crystal.amount;
                if let Some(name) = name {
                    self.store.vote(id, &name, 1);
                }
                self.save();
                event["pet"] = self.view(id);
            }
            None => {
                // What was considered, to see in the log why it went to no one.
                event["kills"] = Value::Array(
                    kills
                        .iter()
                        .map(|&(ago, mob, _)| {
                            let code = self.mob_code.get(&mob).copied();
                            json!({
                                "npc": code, "name": code.and_then(|c| self.npc_name(c)),
                                "pet": code.and_then(|c| self.pets.droppers.get(&c)), "ago": ago as f64 / 1000.0,
                            })
                        })
                        .collect(),
                );
            }
        }
        (self.emit)(event);
    }

    /// Your legion, kept with the character playing (the kill feed's "my legion").
    fn my_legion(&mut self, name: &str) {
        let Some(me) = self.store.current.clone() else { return };
        let entry = self.store.characters.entry(me).or_default();
        if entry.legion.as_deref() != Some(name) {
            entry.legion = Some(name.to_string());
            self.save();
        }
    }

    /// A player killed a player around you (the killing blow): passed on once,
    /// with the victim if they were in view, and whether it was you or your legion.
    fn pvp_kill(&mut self, ts: i64, credit: &p::KillCredit) {
        let key = (credit.victim, credit.killer);
        if self.pvp_seen.get(&key).is_some_and(|&at| ts - at < PVP_REPEAT_MS) {
            return;
        }
        self.pvp_seen.retain(|_, at| ts - *at < 2 * PVP_REPEAT_MS);
        self.pvp_seen.insert(key, ts);
        let me = self.store.current.clone();
        let mine_entry = me.as_ref().and_then(|m| self.store.characters.get(m)).cloned().unwrap_or_default();
        if me.as_deref() == Some(credit.name.as_str()) {
            if let Some(legion) = &credit.legion {
                self.my_legion(legion);
            }
        }
        let my_legion = me.as_ref().and_then(|m| self.store.characters.get(m)?.legion.clone());
        let died = self.self_entity.is_some() && Some(credit.victim) == self.self_entity;
        let victim = if died {
            Some(json!({ "name": me, "server": mine_entry.server, "guild": my_legion }))
        } else {
            self.players.get(&credit.victim).map(|v| {
                json!({ "name": v.name, "server": v.server, "guild": v.legion.clone().or_else(|| self.legions.get(&credit.victim).cloned()) })
            })
        };
        let killer_legion = credit.legion.clone().or_else(|| self.legions.get(&credit.killer).cloned());
        // Legion names are per server: one of the same name elsewhere is another legion.
        let ours = |legion: Option<&str>, server: Option<u64>| {
            my_legion.is_some()
                && legion == my_legion.as_deref()
                && (server.is_none() || mine_entry.server.is_none() || server == mine_entry.server.map(u64::from))
        };
        let legion = ours(killer_legion.as_deref(), Some(credit.server as u64))
            || victim.as_ref().is_some_and(|v| ours(v["guild"].as_str(), v["server"].as_u64()));
        let mine = me.as_deref() == Some(credit.name.as_str()) && mine_entry.server.is_none_or(|s| s == credit.server);
        let fight = self.save_pvp_fight(ts, credit, mine, died, my_legion.clone(), mine_entry.server);
        let victim = victim.map(|mut v| {
            let server = v["server"].as_u64().and_then(|s| u16::try_from(s).ok());
            let class = v["name"].as_str().and_then(|n| self.class_of(Some(credit.victim), n, server));
            v["className"] = json!(class);
            v["combatPower"] = json!(v["name"].as_str().and_then(|n| self.combat_power_of(n, server)));
            v
        });
        (self.emit)(json!({
            "type": "pvpKill", "ts": ts, "fight": fight,
            "killer": {
                "name": credit.name, "server": credit.server, "guild": killer_legion,
                "className": self.class_of(Some(credit.killer), &credit.name, Some(credit.server)),
                "combatPower": self.combat_power_of(&credit.name, Some(credit.server)),
            },
            "victim": victim,
            "mine": mine,
            "died": died,
            "legion": legion,
        }));
    }
}

/// A player's card, as last read.
#[derive(Debug, Clone, Default)]
struct Card {
    level: u32,
    gear_score: u32,
    /// By its number in target info (`50 36`) or the card (`30 97`).
    class: Option<&'static str>,
    /// Combat power as shown: a believable value, held against odd jumps (`steady_cp`).
    cp: Option<u32>,
    /// A value far from the shown one, seen once: taken if the next read agrees.
    pending: Option<u32>,
    /// When it was last updated (`card_tick`): the oldest goes first when there are too many.
    touched: u64,
}

const CARDS_FILE: &str = "player-cards.json";
const CARDS_SAVE_EVERY_MS: i64 = 60_000;
const CLASSES: [&str; 8] = ["Gladiator", "Templar", "Ranger", "Assassin", "Spiritmaster", "Sorcerer", "Cleric", "Chanter"];

/// A card as kept on disk.
#[derive(serde::Serialize, serde::Deserialize)]
struct SavedCard {
    name: String,
    server: u16,
    level: u32,
    gear_score: u32,
    class: Option<String>,
    cp: Option<u32>,
}

/// The cards kept from earlier runs, the newest data of each player winning as it is read.
fn load_cards(path: Option<PathBuf>) -> HashMap<(String, u16), Card> {
    let list: Vec<SavedCard> = path.and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    list.into_iter()
        .take(MAX_CARDS)
        .map(|c| {
            let class = c.class.and_then(|k| CLASSES.iter().find(|&&n| n == k).copied());
            ((c.name, c.server), Card { level: c.level, gear_score: c.gear_score, class, cp: c.cp, pending: None, touched: 0 })
        })
        .collect()
}

/// An enemy's pin moves on the map this often at most (a fight sends many effects a second).
const ENEMY_MOVE_EVERY_MS: i64 = 1000;
/// Cards kept at most: past it the oldest makes room (a long session among crowds).
const MAX_CARDS: usize = 5000;
/// Combat power players have (late 2026: most 90k-175k, some past 200k); outside it, a misread.
const CP_RANGE: std::ops::RangeInclusive<u32> = 20_000..=400_000;
/// A change bigger than this share of the shown value is a jump, until a second read confirms it.
const CP_JUMP: f64 = 0.25;

/// The combat power a card shows: values out of range are dropped; one far from the last (a jump
/// another tool saw now and then) is held until a second read close to it agrees, as a real
/// change (new gear) would.
fn steady_cp(card: &mut Card, value: u32) {
    if !CP_RANGE.contains(&value) {
        return;
    }
    let near = |a: u32, b: u32| (a as f64 - b as f64).abs() <= b as f64 * CP_JUMP;
    match card.cp {
        Some(shown) if !near(value, shown) => {
            if card.pending.is_some_and(|p| near(value, p)) {
                card.cp = Some(value);
                card.pending = None;
            } else {
                card.pending = Some(value);
            }
        }
        _ => {
            card.cp = Some(value);
            card.pending = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(op: [u8; 2], body: &[u8]) -> Vec<u8> {
        let mut out = vec![(body.len() + 6) as u8];
        out.extend_from_slice(&op);
        out.extend_from_slice(body);
        out
    }

    fn le(parts: &[u32]) -> Vec<u8> {
        parts.iter().flat_map(|p| p.to_le_bytes()).collect()
    }

    fn soul(pets: &[(u32, u32)]) -> Vec<u8> {
        let mut body = vec![pets.len() as u8];
        for &(pet, n) in pets {
            body.extend(le(&[pet, n]));
        }
        frame(p::OP_SOUL, &body)
    }

    fn character(entity: u8, name: &str, server: u16) -> Vec<u8> {
        let mut body = vec![entity, 0, 0, 0, 0, 0, name.len() as u8];
        body.extend(name.as_bytes());
        body.extend(server.to_le_bytes());
        frame(p::OP_SELF, &body)
    }

    fn collection(pets: &[(u32, u32, u32)]) -> Vec<u8> {
        let mut body = vec![0, 0, 0, 0, pets.len() as u8];
        for &(pet, level, _) in pets {
            body.extend(le(&[pet, pet, level]));
        }
        body.push(pets.len() as u8);
        for &(pet, _, souls) in pets {
            body.extend(le(&[pet, souls]));
        }
        frame(p::OP_COLLECTION, &body)
    }

    #[test]
    fn a_field_boss_killed_in_view_is_told() {
        let (mut t, events) = tracker();
        t.mob_code.insert(77, 2_100_003);
        t.mob_code.insert(78, 2_101_120);
        t.mob_code.insert(79, 2_000_001);
        // Neikel killed; Dartan only out of range; an ordinary monster killed.
        t.frame(1000, &frame(p::OP_DEATH, &[77, 0, 3]));
        t.frame(1100, &frame(p::OP_DEATH, &[78, 0, 1]));
        t.frame(1200, &frame(p::OP_DEATH, &[79, 0, 3]));
        let kills: Vec<_> = events.lock().unwrap().iter().filter(|e| e["type"] == "bossKilled").cloned().collect();
        assert_eq!(kills, vec![json!({ "type": "bossKilled", "ts": 1000, "npc": 2_100_003 })]);
    }

    #[test]
    fn field_boss_diagnostics_only_logs_unknown_messages() {
        let unknown_op = [0x10, 0x20];
        // 101001 as a varint, followed by 101021 as a u32.
        let unknown = frame(unknown_op, &[0x89, 0x95, 0x06, 0x00, 0x9d, 0x8a, 0x01, 0x00]);
        let respawn = 1_794_010_200_000u64;
        let mut list = vec![0, 0, 20, 0, 0, 0, 1, 0, 0x9d, 0x95, 0x06];
        list.extend(respawn.to_le_bytes());
        let list = frame(p::OP_FIELD_BOSSES, &list);

        for enabled in [false, true] {
            let (mut t, events) = tracker();
            t.frame(60_000, &unknown);
            assert!(t.boss_messages.is_empty(), "scan must be off by default");
            t.set_boss_diagnostics(enabled);
            t.frame(61_000, &unknown);
            t.frame(62_000, &unknown);
            assert_eq!(t.boss_messages.get(&unknown_op).copied(), enabled.then_some(61_000));
            assert!(events.lock().unwrap().is_empty());

            t.mob_code.insert(77, 2_100_003);
            t.frame(63_000, &list);
            t.frame(64_000, &frame(p::OP_DEATH, &[77, 0, 3]));
            assert_eq!(*events.lock().unwrap(), vec![
                json!({ "type": "fieldBosses", "ts": 63_000, "world": 20,
                    "bosses": [{ "id": 101021, "up": false, "at": respawn }] }),
                json!({ "type": "bossKilled", "ts": 64_000, "npc": 2_100_003 }),
            ]);

            t.set_boss_diagnostics(false);
            t.frame(130_000, &unknown);
            assert_eq!(t.boss_messages.get(&unknown_op).copied(), enabled.then_some(61_000));
        }
    }

    fn tracker() -> (Tracker, Arc<std::sync::Mutex<Vec<Value>>>) {
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = events.clone();
        let t = Tracker::new(
            Store::default(),
            None,
            Arc::new(NpcLookup::new()),
            Arc::new(DataStorage::new()),
            Box::new(move |ev| sink.lock().unwrap().push(ev)),
        );
        (t, events)
    }

    fn pet(t: &Tracker, id: u32) -> Pet {
        t.store.pets().and_then(|p| p.get(&id)).cloned().unwrap_or_default()
    }

    /// The login's counters come before the record naming the character: they are hers. With
    /// no record after them, they are the character playing's.
    #[test]
    fn the_login_counters_go_to_the_character_logging_in() {
        let (mut t, events) = tracker();
        let counters = |energy: u8| frame(p::OP_COUNTERS, &[1, 0x0C, 0x01, 0x87, 0x93, 0x03, energy, 0x9B, 0x01]);
        t.frame(1000, &character(5, "Ksix", 1104));
        t.frame(2000, &counters(60));
        assert!(!events.lock().unwrap().iter().any(|e| e["type"] == "counters"));
        t.frame(8000, &character(6, "Ksixx", 1104));
        t.frame(9000, &counters(45));
        t.frame(9000 + COUNTERS_WAIT_MS + 1, &soul(&[(1006, 1)]));
        let read: Vec<_> = events.lock().unwrap().iter().filter(|e| e["type"] == "counters").cloned().collect();
        assert_eq!(read.len(), 2);
        assert_eq!((read[0]["name"].as_str(), read[0]["values"]["60000001"].clone()), (Some("Ksixx"), json!([60, 155])));
        assert_eq!((read[1]["name"].as_str(), read[1]["values"]["60000001"].clone()), (Some("Ksixx"), json!([45, 155])));
    }

    /// A corridor given while the counters wait for the record naming you: told after them, both
    /// at the time the game sent them.
    #[test]
    fn counter_changes_follow_the_counters_they_came_after() {
        let (mut t, events) = tracker();
        t.frame(1000, &character(5, "Ksix", 1104));
        t.frame(2000, &frame(p::OP_COUNTERS, &[1, 0x00, 0x82, 0x96, 0x98, 0x00]));
        t.frame(2500, &frame(p::OP_COUNTER, &[0, 0x01, 0x82, 0x96, 0x98, 0x00, 0xd0, 0xfb, 0x01, 0, 0, 0, 0, 0, 0x02]));
        t.frame(4000, &character(5, "Ksix", 1104));
        t.frame(6000, &frame(p::OP_COUNTER, &[0, 0x00, 0x82, 0x96, 0x98, 0x00, 0x03]));
        let got: Vec<_> = events.lock().unwrap().iter().filter(|e| e["type"] == "counters" || e["type"] == "counter").cloned().collect();
        assert_eq!(got.len(), 3);
        assert_eq!((got[0]["type"].as_str(), got[0]["ts"].as_i64(), got[0]["values"]["10000002"].clone()), (Some("counters"), Some(2000), json!([])));
        assert_eq!((got[1]["ts"].as_i64(), got[1]["id"].as_str(), got[1]["values"].clone()), (Some(2500), Some("10000002"), json!([130000])));
        assert_eq!((got[2]["ts"].as_i64(), got[2]["name"].as_str(), got[2]["values"].clone()), (Some(6000), Some("Ksix"), json!([])));
    }

    #[test]
    fn a_pickup_for_two_pets_counts_both_and_a_level_keeps_the_souls_past_its_cost() {
        let (mut t, events) = tracker();
        t.frame(1000, &character(5, "Ksix", 1104));
        t.frame(2000, &collection(&[(1006, 0, 4), (1015, 1, 24)]));
        t.frame(2100, &character(5, "Ksix", 1104));
        // 4/5 and 24/25: one more each levels both, and 1015's second soul is kept.
        t.frame(3000, &soul(&[(1006, 1), (1015, 2)]));
        assert_eq!((pet(&t, 1006).level, pet(&t, 1006).souls), (Some(1), 0));
        assert_eq!((pet(&t, 1015).level, pet(&t, 1015).souls), (Some(2), 1));
        let souls: Vec<_> = events.lock().unwrap().iter().filter(|e| e["type"] == "soul").cloned().collect();
        assert_eq!(souls.len(), 2);
        assert!(souls.iter().all(|s| s["levelUp"] == true));
        assert_eq!(souls[1]["pet"]["session"], 2);
    }

    #[test]
    fn a_crystal_never_maxes_a_pet_the_game_says_is_below_lv3() {
        let (mut t, events) = tracker();
        let (&code, &id) = t.pets.droppers.iter().min().unwrap();
        t.frame(1000, &character(5, "Ksix", 1104));
        t.frame(1100, &collection(&[(id, 2, 65)]));
        t.frame(1200, &character(5, "Ksix", 1104));
        // Its monster died just before a crystal (another pet's, maxed, whose kill was not seen).
        t.mob_code.insert(77, code);
        t.credits.push_back((2000, 77, 5));
        t.crystal(2100, &p::Crystal { genus: 9, amount: 1, raw: vec![] });
        let now = pet(&t, id);
        assert_eq!((now.level, now.souls, now.crystals), (Some(2), 65, 0));
        let ev = events.lock().unwrap().iter().rfind(|e| e["type"] == "crystal").cloned().unwrap();
        assert_eq!(ev["pet"], Value::Null);
        // Not known from the game: the crystal says it is maxed.
        let (mut t, _) = tracker();
        t.mob_code.insert(77, code);
        t.credits.push_back((2000, 77, 5));
        t.crystal(2100, &p::Crystal { genus: 9, amount: 1, raw: vec![] });
        assert_eq!((pet(&t, id).level, pet(&t, id).crystals), (Some(MAX_LEVEL), 1));
    }

    /// Three chests opened on 2026-11-05 (A2Tools Plugins' `tests/pet-souls-chests.json`):
    /// from the game's pet list before them, their records must reach the list the game
    /// sent after a reconnect. Seven new pets (`09 90`), and three at 24/25 levelled by 5
    /// souls, with 4 left.
    #[test]
    fn chests_new_pets_and_souls_past_a_levels_cost_reach_the_games_list() {
        let fixture: Value = serde_json::from_str(include_str!("testdata/pet-chests.json")).unwrap();
        let id = |k: &str| k.parse::<u32>().unwrap();
        let get = |side: &str, part: &str, pet: u32| fixture[side][part][pet.to_string()].as_u64().map(|v| v as u32);
        let (mut t, _) = tracker();
        t.frame(1000, &character(5, "Ksix", 1104));
        let mut pets: Vec<u32> = ["before", "after"]
            .iter()
            .flat_map(|side| ["levels", "points"].map(|part| (side, part)))
            .flat_map(|(side, part)| fixture[*side][part].as_object().unwrap().keys().map(|k| id(k)).collect::<Vec<_>>())
            .collect();
        pets.sort_unstable();
        pets.dedup();
        for &p in &pets {
            if get("before", "levels", p).is_some() || get("before", "points", p).is_some() {
                let pet = t.store.pets_mut().entry(p).or_default();
                pet.level = get("before", "levels", p);
                pet.souls = get("before", "points", p).unwrap_or(0);
            }
        }
        let mut ts = 2000;
        for event in fixture["events"].as_array().unwrap() {
            let (kind, data) = (event[0].as_str().unwrap(), &event[1]);
            let n = |k: &str| data[k].as_u64().unwrap() as u32;
            ts += 100;
            match kind {
                "decoded:pet-unlocked" => t.frame(ts, &frame(p::OP_PET_UNLOCKED, &[&[0u8, 0][..], &le(&[n("pet"), n("level")])].concat())),
                "decoded:level-up" => t.frame(ts, &frame(p::OP_LEVEL_UP, &[&[0u8, 0][..], &le(&[n("pet"), n("level")])].concat())),
                "decoded:soul-gained" => {
                    let list: Vec<(u32, u32)> = data["souls"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|s| (s["pet"].as_u64().unwrap() as u32, s["amount"].as_u64().unwrap() as u32))
                        .collect();
                    t.frame(ts, &soul(&list));
                }
                other => panic!("an event the test doesn't know: {other}"),
            }
        }
        for &p in &pets {
            let now = pet(&t, p);
            assert_eq!(now.level.unwrap_or(0), get("after", "levels", p).unwrap_or(0), "pet {p}'s level");
            assert_eq!(now.souls, get("after", "points", p).unwrap_or(0), "pet {p}'s souls");
        }
    }

    fn abyss(points: u64, limit: u64) -> Vec<u8> {
        frame(p::OP_ABYSS_POINTS, &[points.to_le_bytes(), limit.to_le_bytes()].concat())
    }

    fn abyss_events(events: &Arc<std::sync::Mutex<Vec<Value>>>) -> Vec<(Value, u64)> {
        events.lock().unwrap().iter().filter(|e| e["type"] == "abyss").map(|e| (e["name"].clone(), e["gained"].as_u64().unwrap())).collect()
    }

    #[test]
    fn abyss_points_a_login_is_a_start_and_each_rise_after_it_a_gain() {
        let (mut t, events) = tracker();
        // A login: the total just before the record naming the character.
        t.frame(1000, &abyss(132_456, 2_500_000));
        t.frame(1500, &character(5, "Ksix", 1104));
        // Gains, each told once nothing names another character for a moment.
        t.frame(10_000, &abyss(133_369, 2_500_000));
        t.frame(14_000, &soul(&[(1006, 1)]));
        t.frame(20_000, &abyss(133_500, 2_500_000));
        t.frame(21_000, &abyss(133_600, 2_500_000));
        t.frame(25_000, &soul(&[(1006, 1)]));
        // Another character logs in: its own total, not a gain (nor a loss) of Ksix's.
        t.frame(30_000, &abyss(40_000, 2_500_000));
        t.frame(30_500, &character(6, "Alt", 1104));
        // A zone move re-sends the self record: a gain just before it is still a gain.
        t.frame(40_000, &abyss(40_100, 2_500_000));
        t.frame(40_500, &character(6, "Alt", 1104));
        // Back on Ksix: from Ksix's last total.
        t.frame(50_000, &abyss(133_600, 2_500_000));
        t.frame(50_500, &character(5, "Ksix", 1104));
        // A total far past the last (earned with the app off): a new start.
        t.frame(60_000, &abyss(180_000, 2_500_000));
        t.frame(64_000, &soul(&[(1006, 1)]));
        let ksix = json!("Ksix");
        let alt = json!("Alt");
        assert_eq!(
            abyss_events(&events),
            [(ksix.clone(), 0), (ksix.clone(), 913), (ksix.clone(), 131), (ksix.clone(), 100), (alt.clone(), 0), (alt, 100), (ksix.clone(), 0), (ksix, 0)]
        );
        assert_eq!(t.store.characters["Ksix"].abyss_points, Some(180_000));
    }

    #[test]
    fn a_level_up_the_count_missed_takes_its_cost_not_every_soul() {
        let (mut t, _) = tracker();
        t.frame(1000, &character(5, "Ksix", 1104));
        t.frame(1100, &collection(&[(1006, 1, 29)]));
        t.frame(1200, &character(5, "Ksix", 1104));
        t.frame(2000, &frame(p::OP_LEVEL_UP, &[&[0u8, 0][..], &le(&[1006, 2])].concat()));
        assert_eq!((pet(&t, 1006).level, pet(&t, 1006).souls), (Some(2), 4));
    }

    #[test]
    fn the_games_level_up_is_taken_when_the_count_missed_it() {
        let (mut t, events) = tracker();
        t.frame(1000, &soul(&[(1006, 3)]));
        assert_eq!((pet(&t, 1006).level, pet(&t, 1006).level_estimated), (Some(0), true));
        // The game says Lv2: souls were missed.
        t.frame(2000, &frame(p::OP_LEVEL_UP, &[&[0u8, 0][..], &le(&[1006, 2])].concat()));
        let now = pet(&t, 1006);
        assert_eq!((now.level, now.souls, now.level_estimated), (Some(2), 0, false));
        assert!(events.lock().unwrap().iter().any(|e| e["type"] == "pet"));
        // Already there from its souls: nothing changes.
        t.frame(3000, &soul(&[(1006, 1)]));
        t.frame(3100, &frame(p::OP_LEVEL_UP, &[&[0u8, 0][..], &le(&[1006, 2])].concat()));
        assert_eq!(pet(&t, 1006).souls, 1);
    }

    #[test]
    fn each_server_has_its_own_collection_and_the_login_sync_goes_to_the_one_entering() {
        let (mut t, events) = tracker();
        t.frame(1000, &character(5, "Ksix", 1104));
        t.frame(1100, &collection(&[(1006, 1, 10)]));
        t.frame(1200, &character(5, "Ksix", 1104));
        // An alt on the same server: the same collection.
        t.frame(5000, &collection(&[(1006, 1, 11)]));
        t.frame(5100, &character(6, "Alt", 1104));
        assert_eq!(t.store.key(), "1104");
        assert_eq!(pet(&t, 1006).souls, 11);
        // A character on another server: its own, and the sync before its record is its.
        t.frame(9000, &collection(&[(1006, 0, 2)]));
        t.frame(9100, &character(7, "Other", 2104));
        assert_eq!(t.store.key(), "2104");
        assert_eq!(pet(&t, 1006).souls, 2);
        assert_eq!(t.store.servers["1104"].pets[&1006].souls, 11, "the first server's is untouched");
        let evs = events.lock().unwrap();
        let syncs = evs.iter().filter(|e| e["type"] == "sync").count();
        let characters: Vec<_> = evs.iter().filter(|e| e["type"] == "character").map(|e| e["name"].clone()).collect();
        assert_eq!(syncs, 3);
        assert_eq!(characters, vec![json!("Ksix"), json!("Alt"), json!("Other")]);
    }

    fn effect(target: u8, x: f32, y: f32) -> Vec<u8> {
        let mut body = vec![7, 0x11];
        body.extend(1_792_350_000_000u64.to_le_bytes());
        body.extend([target, 0x01, 0x00]);
        for v in [x, y, 15_000.0f32] {
            body.extend(v.to_le_bytes());
        }
        frame(p::OP_EFFECTS[0], &body)
    }

    #[test]
    fn effects_on_you_say_where_you_are_and_a_misread_jump_does_not() {
        let (mut t, _) = tracker();
        t.frame(1000, &character(5, "Ksix", 1104));
        // Someone else's effect: not you.
        t.frame(1100, &effect(9, 5000.0, 6000.0));
        assert_eq!(t.position, None);
        t.frame(1200, &effect(5, 5000.0, 6000.0));
        assert_eq!(t.position, Some((5000.0, -6000.0)));
        // 50,000 away 0.1 s later: no one moves that fast.
        t.frame(1300, &effect(5, 55_000.0, 6000.0));
        assert_eq!(t.position, Some((5000.0, -6000.0)));
        // 300 away a second later: walking.
        t.frame(2200, &effect(5, 5300.0, 6000.0));
        assert_eq!(t.position, Some((5300.0, -6000.0)));
        assert!(t.nearby_dirty);
    }

    #[test]
    fn a_cube_in_view_is_reported_until_it_is_opened() {
        let (mut t, events) = tracker();
        let mut cube = vec![0xe5, 0xff, 0x03, 0x04, 0x00];
        cube.extend(1_200_039u32.to_le_bytes());
        for v in [-50205.0f32, 126283.0, 15449.0, 0.0, 0.0] {
            cube.extend(v.to_le_bytes());
        }
        cube.extend([1, 1, 1]);
        cube.extend(1_792_350_000_000u64.to_le_bytes());
        t.frame(1000, &frame(p::OP_OBJECT_SPAWN, &cube));
        // Another object (a gathering spot): not a cube.
        let mut other = cube.clone();
        other[5..9].copy_from_slice(&1_500_041u32.to_le_bytes());
        other[0] = 0x10;
        t.frame(1100, &frame(p::OP_OBJECT_SPAWN, &other));
        let shown = t.cubes();
        assert_eq!(shown.as_array().unwrap().len(), 1);
        assert_eq!(shown[0]["position"], json!([-50205, -126283]));
        t.frame(2000, &frame(p::OP_OBJECT_REMOVED, &[0xe5, 0xff, 0x03, 0x04, 0x03, 0x00]));
        assert!(t.cubes().as_array().unwrap().is_empty());
        let reported = events.lock().unwrap().iter().filter(|e| e["type"] == "cubes").count();
        assert_eq!(reported, 2, "once in view, once opened");
    }

    #[test]
    fn a_sync_with_no_character_record_after_it_goes_to_the_one_playing() {
        let (mut t, _) = tracker();
        t.frame(1000, &collection(&[(1006, 1, 7)]));
        assert_eq!(pet(&t, 1006).souls, 0, "waiting for the character record");
        t.frame(1000 + SYNC_WAIT_MS + 1, &frame([0x99, 0x99], &[]));
        assert_eq!(pet(&t, 1006).souls, 7);
    }

    #[test]
    fn combat_power_drops_misreads_and_holds_a_jump_until_confirmed() {
        let mut c = Card::default();
        steady_cp(&mut c, 5);
        assert_eq!(c.cp, None);
        steady_cp(&mut c, 123_186);
        assert_eq!(c.cp, Some(123_186));
        // A jump: held, the shown value stays.
        steady_cp(&mut c, 390_000);
        assert_eq!(c.cp, Some(123_186));
        // Back to normal: the jump is forgotten.
        steady_cp(&mut c, 124_000);
        assert_eq!((c.cp, c.pending), (Some(124_000), None));
        // A real change, read twice: taken.
        steady_cp(&mut c, 170_000);
        steady_cp(&mut c, 171_000);
        assert_eq!(c.cp, Some(171_000));
    }

    /// `45 36` for a player of `faction` (1 Elyos, 2 Asmodian), with no server record: the faction
    /// byte after the name's u32 says it.
    fn player_frame(entity: u8, name: &str, faction: u8) -> Vec<u8> {
        let mut body = vec![entity, 0, 0, 0, 0, name.len() as u8];
        body.extend(name.as_bytes());
        body.extend([0, 0, 0, 0, faction]);
        frame(p::OP_PLAYER, &body)
    }

    fn enemy_names(events: &Arc<std::sync::Mutex<Vec<Value>>>) -> Vec<String> {
        let list = events.lock().unwrap();
        let last = list.iter().rev().find(|e| e["type"] == "enemies").cloned().unwrap_or(Value::Null);
        last["players"].as_array().map(|ps| ps.iter().filter_map(|p| p["name"].as_str().map(str::to_string)).collect()).unwrap_or_default()
    }

    #[test]
    fn an_enemy_leaves_the_list_when_out_of_view_or_in_a_new_zone() {
        let (mut t, events) = tracker();
        // You: Elyos (server 1104).
        t.frame(1000, &character(5, "Ksix", 1104));
        t.frame(1100, &player_frame(40, "Friend", 1));
        t.frame(1200, &player_frame(41, "Loperamida", 2));
        t.frame(1300, &player_frame(42, "Varkhen", 2));
        assert_eq!(enemy_names(&events), vec!["Loperamida", "Varkhen"]);
        // Out of view.
        t.frame(2000, &frame(p::OP_PLAYER_GONE, &[41, 0x02, 0x00]));
        assert_eq!(enemy_names(&events), vec!["Varkhen"]);
        // A new zone: no one.
        t.frame(3000, &frame(p::OP_MAP_LOAD, &[0u8; 28]));
        assert!(enemy_names(&events).is_empty());
    }

    /// The Abyss since the 2026-11 update: players of your own faction from another server fight you
    /// (AlvaroDust, 1401, an enemy; Mitsuro, your server 1406, an ally; the owner's 2026-11-25 log).
    #[test]
    fn the_abyss_enemies_include_your_own_faction_from_another_server() {
        let (mut t, events) = tracker();
        t.frame(1000, &character(5, "Ksix", 1406));
        let hex = |h: &str| -> Vec<u8> { (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect() };
        // The game's own bytes, from the opcode on, behind a length (a varint, two bytes here).
        let with_len = |h: &str| {
            let b = hex(h);
            let n = b.len() + 2;
            let mut out = vec![(n & 0x7f) as u8 | 0x80, (n >> 7) as u8];
            out.extend(b);
            out
        };
        t.frame(2000, &with_len("4536a1240320a001170a416c7661726f447573740a000000010201c0d6c711b5c64eddba46002c25469d989543c2d401edc402edc4027e0c00007e0c0000000000000000000044f10100ec5202002df40100f049020002000000a0860100a0860100b0e20d00b0e20d00010100000001bb8f014c4bcb01f4d8cc018224c700790598020000000079050450524f47010002000000000000000000000000000000141390010c20a10710270000000000001cd9eb12a2010000a1240e0250c30000e162bdc6eab0c9469b5224461110ebc7c901ffffffffffffffff8075d52abb030000a124017136dcc71ec2c3c700a0aa461111d7c7c901ffffffffffffffff8075d52abb030000a124017136dcc71ec2c3c700a0aa461014844e0000e2abcf6a00000000b299a67da201000010ffff7f7fffff7f7fffff7f7f1132c1129e07ffffffffffffffff8075d52abb030000a1241e7136dcc71ec2c3c700a0aa461133e17e9907ffffffffffffffff8075d52abb030000a1240b7136dcc71ec2c3c700a0aa46113441f89707ffffffffffffffff8075d52abb030000a124147136dcc71ec2c3c700a0aa46113561649307ffffffffffffffff8075d52abb030000a1240e7136dcc71ec2c3c700a0aa46113601eb9407ffffffffffffffff8075d52abb030000a1240b007136dcc71ec2c3c700a0aa461137a1719607ffffffffffffffff8075d52abb030000a124107136dcc71ec2c3c700a0aa46113881059b07ffffffffffffffff8075d52abb030000a124157136dcc71ec2c3c700a0aa461139218c9c07ffffffffffffffff8075d52abb030000a1241a7136dcc71ec2c3c700a0aa46113a61999f07ffffffffffffffff8075d52abb030000a124127136dcc71ec2c3c700a0aa46113b0120a107ffffffffffffffff8075d52abb030000a1240e7136dcc71ec2c3c700a0aa46113e93250000ffffffffffffffff8075d52abb030000a124016c783dc7969f434700da9e46113fae250000ffffffffffffffff8075d52abb030000a124016c783dc7969f434700da9e46138301b5719607102700000000000056c7eb12a2010000a12410923ec200e0f056c9c6ecb4d7460060254613950129835c071027000000000000e0e2eb12a2010000a1240c8a73bc0070c0bcc60794cb46c3832446139701678c9c07881300000000000001d5eb12a2010000a1241ad7dac200029bb9c6b5abc946796f2446119b0147ad4b07b80b000000000000eecfeb12a2010000a124015449bac62a33c446009c24460f58fa910614010000000000000000000000000003a742300100000000000000000c0562890c14020000000000000000ec0000000000030000000000000000000000000ea5e88a0c130300000000000000000000000000030000000000000000000000000ec654860c14040000000000000000ee0000000000030000000000000000000000000e65db870c140500000000000000000000000000030000000000000000000000000e456f8c0c13060000000000000000ee0000000000030000000000000000000000000ee5f58d0c130700000000000000000000000000030000000000000000000000000e857c8f0c13080000000000000000ce0000000000030000000000000000000000000ec7357c121409000000000000000047b6930300030000000000000000000000000e69bc7d12140a0000000000000000eccdf4fa0200030000000000000000000000000e69bc7d12140b0000000000000000ad23fb0200030000000000000000000000000e00000000000c0000000000000000ee75ce2c0400000e00000000000d00000000000000000000000000000e00000000000e0000000000000000ee7f262c0400000e00000000000f00000000000000000000000000000e01c380030000007a0504cd0052080000ce0048f4ffffd000e6010000270248f4ffff2d00000000000000780e0000de020c2800640000002000c8296433646464535c6400646464647a5165c800646464140064c8073864000000646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646464646400c867426464645f5f6565000000000000646464797966662e2f65496c702e2f65496c7064ffffffffffff0000591c1c591c1c650000000000003d3d682b110964a03c9574793a651f0400b40066ff8585830064676900003d78006e8484846e6f0066260e008c00006d000000a10000006f8484846e7426006e7e7e7e6f74c86b0c0700aa0000653e140ac80080683f000c6600a3056e8383836f745365471c106465150a067d646465a973506a6434376464646465703b349e7d2626658c6511162bc83c64807053c8a16465656565656566657b413f5f200e9664651e6520130d652100000000000000000000000000000000000000000021f4cb1f1b04000005000000a31f0400000000000000"));
        t.frame(2100, &with_len("4536f01c0320a40317074d69747375726f0a000000010202c0d65ecc8fc68248c14600942546562b6c431ca901d2d102d2d1025c0f00005c0f00000000000000000000fcab0200fcab020000320000f049020001000000a0860100a086010032800c0070460d00010100000002939d01f4dfcf01f4dfcf010c27a8007e05f002000000007e05044d6f6f6e010002000000000000000000000000000000161110e5c3c901ffffffffffffffff8075d52abb030000f01c010060acd1c7e114c4c7001aab461111dbc3c901ffffffffffffffff8075d52abb030000f01c0160acd1c7e114c4c7001aab4611c90e93250000ffffffffffffffff8075d52abb030000f01c0152175847d8da52c70042a6461014844e0000d203d86a00000000b299a67da20100000dffff7f7fffff7f7fffff7f7f1130c1129e07ffffffffffffffff8075d52abb030000f01c1760acd1c7e114c4c7001aab461131e17e9907ffffffffffffffff8075d52abb030000f01c0f60acd1c7e114c4c7001aab46113241f89707ffffffffffffffff8075d52abb030000f01c1060acd1c7e114c4c7001aab46113361649307ffffffffffffffff8075d52abb030000f01c1260acd1c7e114c4c7001aab46113401eb9407ffffffffffffffff8075d52abb030000f01c090060acd1c7e114c4c7001aab461135a1719607ffffffffffffffff8075d52abb030000f01c1260acd1c7e114c4c7001aab46113681059b07ffffffffffffffff8075d52abb030000f01c1160acd1c7e114c4c7001aab461137218c9c07ffffffffffffffff8075d52abb030000f01c1660acd1c7e114c4c7001aab46113861999f07ffffffffffffffff8075d52abb030000f01c1060acd1c7e114c4c7001aab4611390120a107ffffffffffffffff8075d52abb030000f01c0f60acd1c7e114c4c7001aab4611ca0eae250000ffffffffffffffff8075d52abb030000f01c0152175847d8da52c70042a64613f70e8d274a07c0d4010000000000da5aed12a2010000f01c0f8e9dba008ae246c6eff901470014164613b011f39a4901c0270900000000008a54f312a2010000f01c01e5f52000806baf7c473c15f546284f004713b111313c5101c0270900000000008a54f312a2010000f01c0138b921006baf7c473c15f546284f004713b411453c5101c0270900000000007258f312a2010000f01c013ab92100d98e7c47dd96f4465250004713b611df475101c027090000000000595cf312a2010000f01c0163ba2100b2197c474246f4460048004713b711cb475101c0270900000000002a64f312a2010000f01c0161ba2100baa57b47a7e8f346b9450047119d1347ad4b07b80b0000000000002d3aec12a2010000f01c015ecc8fc68248c146009425460f23fa9106110100000000000000004ed399000003b46930010000000000000000bb0ac561890c0c0200000000000000002f35ca0100030000000000000000000000000e65e88a0c0c0300000000000000003035ca010003000000000000000000000000bb0e8554860c110400000000000000002d35ca0100030000000000000000000000000e25db870c0c0500000000000000002e35ca010003000000000000000000000000bb0e056f8c0c110600000000000000003135ca0100030000000000000000000000000ea5f58d0c0c0700000000000000003235ca010003000000000000000000000000bb0e457c8f0c110800000000000000003335ca0100030000000000000000000000000e83357c12110900000000000000005f54fc020003000000000000000000000000bb0e25bc7d12110a00000000000000005d54fc0200030000000000000000000000000e25bc7d12110b00000000000000005d54fc020003000000000000000000000000bb0e00000000000c00000000000000000000000000000e00000000000d0000000000000000000000000000bb0e00000000000e00000000000000000000000000000e00000000000f00000000000000000000000000000f0e0149a2030000007b0504cd0052080000ce0048f4ffffd000c8010000270248f4ffff2d00000000000000c80b0000de020c64626260605e285e5858626864986864646478646468606e686e5e5a64646c6a6e68665e5e6464826469646464646464646464646464646464646464646464646464646464505a6e645a466464646464646464646450645a5a5c6464646464646464646400a16650646464796a65650202040202046464647d796666d4c0420302020a0c0c140e0e64ffffffffffff0000591c1c591c1c66000000000000331d650804016f323da85e8d95661f0400b40065ff858564006465860000327800708484846e6f00652205008c000065000000a10000007184848470c800006e84848470c80066000000aa000066410f0fb4008c65300000c8008c0070ffffff6fc8006500000000650000007d646465070c0c6a6434376464646465703b349e7d2626658c65ffffff0000c8ffffff0000c865656565656584710d0d0d5f200e2864651e6520130d65000000000000000000000000000000000000000000000226f4cb1f6e04000008000000f92d03000000000000"));
        assert_eq!(enemy_names(&events), vec!["AlvaroDust"]);
    }
}
