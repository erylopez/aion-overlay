//! The engine as the app's helper: JSON lines in, JSON lines out. The events
//! and commands are the Python tracker's (sidecar.py, which this replaces),
//! plus the DPS meter's.
//!
//!   lokthar-engine [--data collection.json] [--app-pid N] [--paused] [--replay X.pcap [--speed 4]]
//!
//! stdout, one JSON object per line (nothing else is ever written there):
//!
//!   {"type": "ready", "pets": [...], "character": {"name", "server"} | null, "data", "replay", "version"}
//!   {"type": "character", "name": "Ksix", "server": 1104, "switched": true, "pets": [...]}
//!       a character entered the world, on another server than the collection's (its own)
//!       or for the first time
//!   {"type": "status", "state": "listening" | "locked" | "idle" | "stopped" | "error", "server"?, "detail"?}
//!   {"type": "heartbeat", "lastPacketAgo": 1.2}       every 2 s while capturing
//!   {"type": "player", "level": 45}                   your level, when it is first read and when it changes
//!   {"type": "sync", "pets": 119, "souls": 938, "corrected": [...], "collection": [...]}
//!   {"type": "soul", "amount": 1, "pet": {...}, "levelUp": false}     one per pet a pickup gives souls to
//!   {"type": "crystal", "amount": 1, "genus": "fera" | "cogni" | null, "pet": {...} | null,
//!    "npc", "raw", "levelCorrected", "kills": [{"npc", "name", "pet", "ago"}]}
//!   {"type": "pet", "pet": {...}}                     after an edit, or a level-up the game sent
//!   {"type": "combat"}                                you killed something (at most every 5 s)
//!   {"type": "kina", "balance": 3769926}
//!   {"type": "shop", "tab": 104, "nextAt": ms | null, "items": [{"slot", "item", "quantity", "currency", "base", "price"}]}
//!   {"type": "fieldBosses", "world": 1010, "bosses": [{"id": 101021, "up": false, "at": ms}]}
//!   {"type": "pvpKill", "killer": {"name", "server", "guild"}, "victim": {...} | null, "mine", "died", "legion"}
//!   {"type": "snapshot", "pets": [...]}               answer to "snapshot" (then a nearby)
//!   {"type": "nearby", "world": 1010, "position": [x, y] | null, "monsters": [{"npc", "count"}]}
//!   {"type": "cubes", "cubes": [{"id", "template", "position": [x, y], "height", "createdAt": ms | null}]}
//!                                                     the Hidden Cubes in view (within ~100 m), when they change
//!   {"type": "dps", ...DpsData}                       the meter, when it changes (else every 5 s)
//!   {"type": "ping", "ms": 42 | null}                 your ping to the game server, when it changes
//!   {"type": "buffs", "buffs": [{"id", "stacks", "endsAt", "startedAt", "by", "skill", "mine", "debuff", "passive"}]}
//!                                                     what is on your character, when it changes (while "buffs" is on)
//!   {"type": "historyChanged", "count": 1}            boss fights were saved (every 30 s, and before a reset)
//!   {"type": "history", "fights": [FightSummary]}     answer to "history"
//!   {"type": "fight", "id", "fight": FightRecord}     answer to "fight"
//!   {"type": "pvpFight", "id", "fight": Fight|null}   answer to "pvpFight" (tracker/pvp.rs)
//!   {"type": "focus", "game": true, "app": false}     what is in front, when it changes (Windows):
//!                                                     the game, the app's own window (--app-pid), or neither
//!   {"type": "details", "target": 123, ...TargetDetailsResponse, "fightBuffs": {"startTimeMs", "durationMs", "buffs"} | null}
//!   {"type": "recording", "on": true, "path": "...", "segments"?: 1234}
//!                                                     a recording started or stopped (it stops with the capture)
//!   {"type": "packets", "on": bool, "path": "...", "count": 1234}
//!                                                     the packet log started, stopped or marked
//!   {"type": "recordings", "dir": "...", "recording": path | null, "files": [{"name", "path", "bytes", "modified": ms}]}
//!                                                     answer to "recordings"
//!   {"type": "error", "detail": "..."}
//!
//! stdin, one JSON object per line:
//!
//!   {"cmd": "snapshot"} · {"cmd": "set", "pet": 1006, "souls": 32} · {"cmd": "name", "pet": 1006, "name": "..."}
//!   {"cmd": "resetSession"}            the session's soul counts start again (answered with a snapshot)
//!   {"cmd": "capture", "on": false}    stop capturing (the game closed) or start again
//!   {"cmd": "meter", "on": false}      stop sending the meter (it is turned off) or start again
//!   {"cmd": "buffs", "on": true}       send your buffs (the buffs overlay is on) or stop
//!   {"cmd": "training", "on": true}    send the meter (its `train`) even while it is off: training runs
//!   {"cmd": "dpsReset"} · {"cmd": "targetMode", "mode": "bossTargets"} · {"cmd": "details", "target": 123, "actors"?: [..]}
//!   {"cmd": "pvpFight", "id": "..."}   a PvP fight saved on a kill or death of yours
//!   {"cmd": "history"} · {"cmd": "fight", "id": "..."} · {"cmd": "deleteFight", "id": "..."}
//!                                      the saved boss fights (in <data folder>/history)
//!   {"cmd": "record", "on": true}      record the game's traffic (<data folder>/recordings), or stop
//!   {"cmd": "recordings"}              the recordings kept
//!   {"cmd": "packets", "on": true}     write every game message to a text file (<data folder>/recordings), or stop
//!   {"cmd": "mark", "text": "..."}     a line in that file between the messages: what you just did
//!   {"cmd": "quit"}                    (closing stdin quits too)
//!
//! A pet is {"id", "name" (null if unknown), "souls", "level", "levelEstimated", "crystals", "session"}.

use std::io::BufRead;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use a2tools_dps_meter_lib::capture::captured_payload::CapturedPayload;
use a2tools_dps_meter_lib::capture::frame_tap;
use a2tools_dps_meter_lib::clock;
use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::capture::pcap_capturer::PcapCapturer;
use crate::capture::frame_log::FrameLog;
use crate::capture::recorder::Recorder;
use crate::meter::Meter;
use crate::tracker::Tracker;
use crate::tracker::store::Store;
use crate::{emit, event};

const DPS_EVERY: Duration = Duration::from_millis(200);
const DPS_RESEND: Duration = Duration::from_secs(5);
const HEARTBEAT: Duration = Duration::from_secs(2);
/// The capture's devices have all been tried by then (physical ones wait 1.5 s).
const DEVICES_OPEN_WITHIN: Duration = Duration::from_secs(5);
const NO_DEVICE_OPENED: &str =
    "No network device could be opened for capture. Reinstall Npcap without \"Restrict Npcap driver's access to Administrators only\", or run the app as administrator.";
/// Your buffs are read this often (ticks of DPS_EVERY: 0.2 s): a knockdown lasts about a second.
const BUFFS_EVERY: u32 = 1;
/// Boss fights are saved this often while they go on, as upstream does.
const SAVE_FIGHTS_EVERY: u32 = 150; // ticks of DPS_EVERY: 30 s

pub struct Options {
    pub data: PathBuf,
    pub paused: bool,
    pub replay: Option<PathBuf>,
    pub speed: f64,
    /// The overlay app's process: its windows in front count as the game's.
    pub app_pid: Option<u32>,
}

impl Options {
    pub fn parse(args: &[String]) -> Result<Self, String> {
        let mut opts = Options { data: PathBuf::from("collection.json"), paused: false, replay: None, speed: 1.0, app_pid: None };
        let mut rest = args.iter();
        while let Some(arg) = rest.next() {
            let mut value = || rest.next().cloned().ok_or(format!("{arg} needs a value"));
            match arg.as_str() {
                "--data" => opts.data = PathBuf::from(value()?),
                "--paused" => opts.paused = true,
                "--replay" => opts.replay = Some(PathBuf::from(value()?)),
                "--speed" => opts.speed = value()?.parse().map_err(|_| "--speed needs a number")?,
                "--app-pid" => opts.app_pid = Some(value()?.parse().map_err(|_| "--app-pid needs a number")?),
                _ => return Err(format!("unexpected argument {arg:?}")),
            }
        }
        Ok(opts)
    }
}

/// Tell the app its fight history changed (`n` fights saved or deleted).
fn announce_saved(n: usize) {
    if n > 0 {
        emit(&event("historyChanged", json!({ "count": n })));
    }
}

/// What is capturing now: live capture, or a recording played back in time.
enum Source {
    Live(Arc<PcapCapturer>),
    Replay(Arc<AtomicBool>),
}

struct Sidecar {
    runtime: tokio::runtime::Runtime,
    meter: Arc<Meter>,
    tracker: Arc<Mutex<Tracker>>,
    replay: Option<(PathBuf, f64)>,
    source: Mutex<Option<Source>>,
    capturing: Arc<AtomicBool>,
    meter_on: Arc<AtomicBool>,
    buffs_on: Arc<AtomicBool>,
    training_on: Arc<AtomicBool>,
    last_frame: Arc<Mutex<Option<Instant>>>,
    recorder: Arc<Mutex<Recorder>>,
    frame_log: Arc<Mutex<FrameLog>>,
}

pub fn run(opts: Options) -> Result<(), String> {
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let meter = Arc::new(Meter::new());
    let pets = crate::tracker::data::pets();
    // A collection that will not read is never written over: the tracker runs
    // without saving, and says so.
    let (store, path) = match Store::load(&opts.data, pets) {
        Ok(store) => (store, (opts.replay.is_none()).then(|| opts.data.clone())),
        Err(e) => {
            emit(&event("status", json!({ "state": "error", "detail": format!("The collection could not be read ({e}); nothing will be saved") })));
            (Store::default(), None)
        }
    };
    let tracker = Arc::new(Mutex::new(Tracker::new(store, path, meter.npcs.clone(), meter.storage.clone(), Box::new(|ev| emit(&ev)))));

    // Boss fights go to <data folder>/history: every 30 s while they go on, and
    // before the combat data is cleared (a zone change, the end of a party, a reset).
    if opts.replay.is_none() {
        let dir = opts.data.parent().map_or_else(|| PathBuf::from("history"), |p| p.join("history"));
        let _ = meter.history.set(crate::history::FightHistoryManager::new(dir));
        let saver = Arc::downgrade(&meter);
        meter.storage.set_before_reset(move || {
            if let Some(meter) = saver.upgrade() {
                announce_saved(meter.save_fights(true));
            }
        });
    }

    let sidecar = Arc::new(Sidecar {
        runtime,
        meter,
        tracker,
        replay: opts.replay.clone().map(|p| (p, opts.speed.max(0.01))),
        source: Mutex::new(None),
        capturing: Arc::new(AtomicBool::new(false)),
        meter_on: Arc::new(AtomicBool::new(true)),
        buffs_on: Arc::new(AtomicBool::new(false)),
        training_on: Arc::new(AtomicBool::new(false)),
        last_frame: Arc::new(Mutex::new(None)),
        recorder: Arc::new(Mutex::new(Recorder::new(
            opts.data.parent().map_or_else(|| PathBuf::from("recordings"), |p| p.join("recordings")),
        ))),
        frame_log: Arc::new(Mutex::new(FrameLog::new(
            opts.data.parent().map_or_else(|| PathBuf::from("recordings"), |p| p.join("recordings")),
        ))),
    });

    // Every frame the parser reads goes through the tracker too, timed by its
    // capture time (the parser's clock is set to it around each parse).
    {
        let tracker = sidecar.tracker.clone();
        let last_frame = sidecar.last_frame.clone();
        let frame_log = sidecar.frame_log.clone();
        frame_tap::set(Some(Arc::new(move |frame: &[u8]| {
            *last_frame.lock() = Some(Instant::now());
            let ts = clock::now_ms();
            frame_log.lock().note(ts, frame);
            tracker.lock().frame(ts, frame);
        })));
    }

    {
        let t = sidecar.tracker.lock();
        emit(&event(
            "ready",
            json!({
                "pets": t.snapshot(), "character": t.character(), "data": opts.data.display().to_string(),
                "replay": opts.replay.is_some(), "version": env!("CARGO_PKG_VERSION"),
            }),
        ));
    }
    if opts.paused && opts.replay.is_none() {
        emit(&event("status", json!({ "state": "idle" })));
    } else {
        sidecar.set_capture(true);
    }
    sidecar.publish();
    sidecar.heartbeat();
    crate::focus::watch(opts.app_pid);

    // Commands, until stdin closes (the app quit) or says quit.
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(msg) => {
                if !sidecar.command(&msg) {
                    break;
                }
            }
            Err(e) => emit(&event("error", json!({ "detail": format!("bad command: {e}") }))),
        }
    }
    sidecar.set_capture(false);
    frame_tap::set(None);
    Ok(())
}

impl Sidecar {
    /// Start or stop capturing. Each capture locks onto the game afresh: the
    /// next game is a new connection.
    fn set_capture(&self, on: bool) {
        let mut source = self.source.lock();
        if on == source.is_some() {
            return;
        }
        if !on {
            match source.take() {
                Some(Source::Live(capturer)) => capturer.stop(),
                Some(Source::Replay(halt)) => halt.store(true, Ordering::SeqCst),
                None => {}
            }
            self.capturing.store(false, Ordering::SeqCst);
            self.stop_recording();
            self.meter.port_detector.reset();
            *self.last_frame.lock() = None;
            let mut tracker = self.tracker.lock();
            tracker.forget_view();
            emit(&event("status", json!({ "state": "idle" })));
            emit(&event("nearby", tracker.nearby()));
            return;
        }
        let (tx, rx) = mpsc::channel::<CapturedPayload>(4096);
        *source = Some(match &self.replay {
            Some((path, speed)) => Source::Replay(self.start_replay(path.clone(), *speed, tx)),
            None => {
                // Live traffic passes the recorder on its way to the parser.
                let (to_recorder, mut from_capture) = mpsc::channel::<CapturedPayload>(4096);
                let (recorder, ports, to_parser) = (self.recorder.clone(), self.meter.port_detector.clone(), tx);
                self.runtime.spawn(async move {
                    while let Some(payload) = from_capture.recv().await {
                        recorder.lock().note(&payload, ports.current_port());
                        if to_parser.send(payload).await.is_err() {
                            break;
                        }
                    }
                });
                let capturer = Arc::new(PcapCapturer::new(to_recorder, self.meter.port_detector.clone()));
                capturer.start();
                if !capturer.is_running() {
                    let why = capturer.start_error().unwrap_or_else(|| "Packet capture did not start (is Npcap installed?)".into());
                    emit(&event("status", json!({ "state": "error", "detail": why })));
                    return;
                }
                // Every device may still fail to open (Npcap installed without the right to
                // capture, or restricted to administrators): say so once they all had their go.
                let watched = Arc::downgrade(&capturer);
                std::thread::spawn(move || {
                    std::thread::sleep(DEVICES_OPEN_WITHIN);
                    if let Some(c) = watched.upgrade()
                        && c.is_running()
                        && c.opened() == 0
                    {
                        emit(&event("status", json!({ "state": "error", "detail": NO_DEVICE_OPENED })));
                    }
                });
                Source::Live(capturer)
            }
        });
        self.capturing.store(true, Ordering::SeqCst);
        let source_name = self.replay.as_ref().map_or("live".to_string(), |(p, _)| p.display().to_string());
        emit(&event("status", json!({ "state": "listening", "source": source_name })));
        let dispatcher = self.meter.dispatcher();
        self.runtime.spawn(async move { dispatcher.run(rx).await });
    }

    /// Finish the recording, if one is going, and say where it went.
    fn stop_recording(&self) {
        if let Some((path, segments)) = self.recorder.lock().stop() {
            emit(&event("recording", json!({ "on": false, "path": path.display().to_string(), "segments": segments })));
        }
    }

    /// A recording played back as if live: in its own time (divided by
    /// `speed`), each packet stamped with when it is sent.
    fn start_replay(&self, path: PathBuf, speed: f64, tx: mpsc::Sender<CapturedPayload>) -> Arc<AtomicBool> {
        let halt = Arc::new(AtomicBool::new(false));
        let stop = halt.clone();
        std::thread::spawn(move || {
            let payloads = match crate::capture::recording::read(&path) {
                Ok(p) => p,
                Err(e) => {
                    emit(&event("status", json!({ "state": "error", "detail": e })));
                    return;
                }
            };
            let start = Instant::now();
            let first = payloads.first().map_or(0, |p| p.captured_at_ms);
            for mut payload in payloads {
                let due = Duration::from_secs_f64((payload.captured_at_ms - first).max(0) as f64 / 1000.0 / speed);
                if let Some(wait) = due.checked_sub(start.elapsed()) {
                    std::thread::sleep(wait);
                }
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                payload.captured_at_ms = clock::now_ms();
                if tx.blocking_send(payload).is_err() {
                    return;
                }
            }
            emit(&event("status", json!({ "state": "stopped" })));
        });
        halt
    }

    /// The meter, when it changes, and the lock, when it does.
    fn publish(self: &Arc<Self>) {
        let me = self.clone();
        self.runtime.spawn(async move {
            let mut tick = tokio::time::interval(DPS_EVERY);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut last: Option<(Value, Instant)> = None;
            let mut port = None;
            let mut ping = None;
            let mut buffs: Option<Value> = None;
            let mut ticks: u32 = 0;
            loop {
                tick.tick().await;
                if !me.capturing.load(Ordering::SeqCst) {
                    port = None;
                    continue;
                }
                ticks = ticks.wrapping_add(1);
                if ticks % SAVE_FIGHTS_EVERY == 0 {
                    let meter = me.meter.clone();
                    if let Ok(saved) = tokio::task::spawn_blocking(move || meter.save_fights(false)).await {
                        announce_saved(saved);
                    }
                }
                // Your ping to the game server, as upstream measures it.
                let now_ping = me.meter.ping.current_ping_ms();
                if now_ping != ping {
                    ping = now_ping;
                    emit(&event("ping", json!({ "ms": ping })));
                }
                let now_port = me.meter.port_detector.current_port();
                if now_port != port {
                    port = now_port;
                    if let Some(port) = port {
                        let host = me.meter.storage.game_host().map_or_else(|| "?".to_string(), |ip| ip.to_string());
                        emit(&event("status", json!({ "state": "locked", "server": format!("{host}:{port}") })));
                    }
                }
                if ticks % BUFFS_EVERY == 0 && me.buffs_on.load(Ordering::SeqCst) {
                    let meter = me.meter.clone();
                    if let Ok(now) = tokio::task::spawn_blocking(move || meter.my_buffs()).await
                        && buffs.as_ref() != Some(&now)
                    {
                        emit(&event("buffs", json!({ "buffs": now })));
                        buffs = Some(now);
                    }
                }
                if !me.meter_on.load(Ordering::SeqCst) && !me.training_on.load(Ordering::SeqCst) {
                    continue;
                }
                let meter = me.meter.clone();
                let Ok(dps) = tokio::task::spawn_blocking(move || meter.dps()).await else { continue };
                if last.as_ref().is_none_or(|(prev, at)| *prev != dps || at.elapsed() >= DPS_RESEND) {
                    emit(&event("dps", dps.clone()));
                    last = Some((dps, Instant::now()));
                }
            }
        });
    }

    /// Every 2 s while capturing: how long since the game's last frame, what
    /// is around you when it changed, and your level when it changed.
    fn heartbeat(self: &Arc<Self>) {
        let me = self.clone();
        self.runtime.spawn(async move {
            let mut tick = tokio::time::interval(HEARTBEAT);
            let mut level = None;
            loop {
                tick.tick().await;
                if !me.capturing.load(Ordering::SeqCst) {
                    continue;
                }
                let ago = me.last_frame.lock().map(|at| (at.elapsed().as_secs_f64() * 10.0).round() / 10.0);
                emit(&event("heartbeat", json!({ "lastPacketAgo": ago })));
                // The parser reads it from the game's record of you (every zone entry).
                let now = me.meter.storage.local_profile().level;
                if now.is_some() && now != level {
                    level = now;
                    emit(&event("player", json!({ "level": now })));
                }
                let mut tracker = me.tracker.lock();
                if tracker.nearby_dirty {
                    emit(&event("nearby", tracker.nearby()));
                }
            }
        });
    }

    /// Carry out one command; false to quit.
    fn command(&self, msg: &Value) -> bool {
        let pet = || msg["pet"].as_u64().map(|p| p as u32).ok_or("no pet");
        let result: Result<(), &str> = (|| {
            match msg["cmd"].as_str().unwrap_or_default() {
                "quit" => return Err("quit"),
                "snapshot" => {
                    let mut t = self.tracker.lock();
                    emit(&event("snapshot", json!({ "pets": t.snapshot() })));
                    emit(&event("nearby", t.nearby()));
                    emit(&event("cubes", json!({ "cubes": t.cubes() })));
                }
                "set" => {
                    let souls = msg["souls"].as_u64().ok_or("no souls")? as u32;
                    let view = self.tracker.lock().set_souls(pet()?, souls);
                    emit(&event("pet", json!({ "pet": view })));
                }
                "name" => {
                    let name = msg["name"].as_str().ok_or("no name")?;
                    let view = self.tracker.lock().set_name(pet()?, name);
                    emit(&event("pet", json!({ "pet": view })));
                }
                "resetSession" => {
                    let mut t = self.tracker.lock();
                    t.reset_session();
                    emit(&event("snapshot", json!({ "pets": t.snapshot() })));
                }
                "capture" => self.set_capture(msg["on"].as_bool().ok_or("no on")?),
                "meter" => self.meter_on.store(msg["on"].as_bool().ok_or("no on")?, Ordering::SeqCst),
                "buffs" => self.buffs_on.store(msg["on"].as_bool().ok_or("no on")?, Ordering::SeqCst),
                "training" => self.training_on.store(msg["on"].as_bool().ok_or("no on")?, Ordering::SeqCst),
                "dpsReset" => self.meter.reset(),
                "record" => {
                    if msg["on"].as_bool().ok_or("no on")? {
                        let path = self.recorder.lock().start().map_err(|e| {
                            emit(&event("error", json!({ "detail": format!("recording not started: {e}") })));
                            "recording not started"
                        })?;
                        emit(&event("recording", json!({ "on": true, "path": path.display().to_string() })));
                    } else {
                        self.stop_recording();
                    }
                }
                "recordings" => emit(&event("recordings", self.recorder.lock().list())),
                "packets" => {
                    let mut log = self.frame_log.lock();
                    if msg["on"].as_bool().ok_or("no on")? {
                        let path = log.start().map_err(|e| {
                            emit(&event("error", json!({ "detail": format!("packet log not started: {e}") })));
                            "packet log not started"
                        })?;
                        emit(&event("packets", json!({ "on": true, "path": path.display().to_string(), "count": log.count() })));
                    } else if let Some((path, count)) = log.stop() {
                        emit(&event("packets", json!({ "on": false, "path": path.display().to_string(), "count": count })));
                    }
                }
                "mark" => {
                    let mut log = self.frame_log.lock();
                    log.mark(clock::now_ms(), msg["text"].as_str().unwrap_or_default());
                    emit(&event("packets", json!({ "on": log.on(), "count": log.count() })));
                }
                "history" => {
                    let fights = self.meter.history.get().map(|h| h.list_fights()).unwrap_or_default();
                    emit(&event("history", json!({ "fights": fights })));
                }
                "pvpFight" => {
                    let id = msg["id"].as_str().ok_or("no id")?;
                    let fight = self.tracker.lock().pvp_fight(id);
                    let mut fight = serde_json::to_value(fight).unwrap_or(Value::Null);
                    // A side whose class was not known then (no card, no skill seen before the
                    // fight): the class its skills in the fight say.
                    let skills = fight["skills"].clone();
                    let class_of = |entity: &Value| {
                        let codes = skills.as_array().into_iter().flatten().filter(|s| &s["actor"] == entity).filter_map(|s| s["code"].as_i64().map(|c| c as i32));
                        json!(crate::tracker::pvp::class_of_skills(codes))
                    };
                    for side in ["me", "opponent"] {
                        if fight[side]["className"].is_null() {
                            fight[side]["className"] = class_of(&fight[side]["entity"]);
                        }
                    }
                    for side in fight.get_mut("others").and_then(Value::as_array_mut).into_iter().flatten() {
                        if side["className"].is_null() {
                            side["className"] = class_of(&side["entity"]);
                        }
                    }
                    // Each skill as the meter names it: a skill's variants folded into it, as
                    // upstream's parser does (the PvP reader keeps raw ids), and its name.
                    if let Some(skills) = fight.get_mut("skills").and_then(Value::as_array_mut) {
                        let mut merged: Vec<Value> = Vec::new();
                        for mut s in skills.drain(..) {
                            let code = self.meter.normalize_skill(s["code"].as_i64().unwrap_or(0) as i32);
                            s["code"] = json!(code);
                            s["name"] = json!(self.meter.skill_name(code));
                            match merged.iter_mut().find(|m| m["actor"] == s["actor"] && m["code"] == s["code"]) {
                                Some(m) => merge_skill_line(m, &s),
                                None => merged.push(s),
                            }
                        }
                        merged.sort_by_key(|s| std::cmp::Reverse(s["damage"].as_i64().unwrap_or(0)));
                        *skills = merged;
                    }
                    emit(&event("pvpFight", json!({ "id": id, "fight": fight })));
                }
                "fight" => {
                    let id = msg["id"].as_str().ok_or("no id")?;
                    let fight = self.meter.history.get().ok_or("no history")?.load_fight(id).map_err(|_| "no such fight")?;
                    emit(&event("fight", json!({ "id": id, "fight": fight })));
                }
                "deleteFight" => {
                    let id = msg["id"].as_str().ok_or("no id")?;
                    self.meter.history.get().ok_or("no history")?.delete_fight(id).map_err(|_| "no such fight")?;
                    announce_saved(1);
                }
                "targetMode" => {
                    if !self.meter.set_target_mode(msg["mode"].as_str().unwrap_or_default()) {
                        return Err("unknown target mode");
                    }
                }
                "details" => {
                    let target = msg["target"].as_i64().ok_or("no target")? as i32;
                    let actors: Option<Vec<i32>> =
                        msg["actors"].as_array().map(|a| a.iter().filter_map(|v| v.as_i64()).map(|v| v as i32).collect());
                    let mut details = self.meter.details(target, actors.as_deref());
                    details["target"] = json!(target);
                    details["fightBuffs"] = self.meter.fight_buffs(target);
                    emit(&event("details", details));
                }
                _ => return Err("unknown command"),
            }
            Ok(())
        })();
        match result {
            Err("quit") => false,
            Err(e) => {
                emit(&event("error", json!({ "detail": format!("{e}: {msg}") })));
                true
            }
            Ok(()) => true,
        }
    }
}

/// Two lines of one skill in a PvP fight (`tracker::pvp::SkillLine` as JSON), added up.
fn merge_skill_line(into: &mut Value, from: &Value) {
    for key in ["damage", "hits", "crits", "back", "perfect", "double", "parry", "multi"] {
        into[key] = json!(into[key].as_i64().unwrap_or(0) + from[key].as_i64().unwrap_or(0));
    }
    into["maxHit"] = json!(into["maxHit"].as_i64().unwrap_or(0).max(from["maxHit"].as_i64().unwrap_or(0)));
    let mut at: Vec<i64> = into["at"].as_array().into_iter().chain(from["at"].as_array()).flatten().filter_map(Value::as_i64).collect();
    at.sort_unstable();
    into["at"] = json!(at);
}
