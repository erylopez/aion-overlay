# Nyerk

*Formerly Aion2 Pet Tracker.* A Windows overlay that counts your Aion 2 **Pet Collection** souls as they drop, so you don't have
to keep opening the Pets menu.

- **Live counts:** every soul is counted the moment it drops, with level-ups (5 → 25 → 75) and the
  genus crystals that maxed (Lv3) pets give instead.
- **Login sync:** when you enter the world, your whole collection is taken from the game, so the
  counts always match the Pets menu.
- **In-game HUD:** a small click-through overlay with nearby soul monsters, this fight's pets and
  a feed of drops. It clears itself between fights.
- **Collection panel:** every pet with its genus, level and progress; search, filter, pin pets to
  the HUD, and see where each soul drops on a map.
- **Kina per hour:** this session's Kina rate with a timeline, in the panel and on the HUD.
- **Timers:** the game's events (Shugo Festival, the Black Cloud Merchant, rifts, the siege…) and
  Verteron's field bosses, read from the map's field boss list, with optional alerts. Field boss
  times are shared between players so they stay right when you have not opened the map.
- **Black Cloud Merchant:** when you open one of its tabs, a window lists the pets it sells that
  you have not maxed, with where their soul monsters spawn.
- **One collection per character:** switching to an alt shows that character's pets.
- **Stays out of the way:** it sits in the tray and sleeps while Aion 2 is closed, waking when the
  game starts.

![The collection panel and the in-game HUD](assets/screenshot.webp)

## How it works

The tracker **only listens** and functions the exact same as popular DPS Meters used in Aion 2. It reads the game's network traffic passively through
[Npcap](https://npcap.com). It never sends anything to the game
or its servers, never reads or changes the game's memory, and sends no input.

The app talks only to **nyerk.app**: to check for updates, and (unless you switch off "Share
field boss timers") to send the field boss times your map shows and get other players' back. That
carries your game server's id and an anonymous hash of your PC, never your character's name or
position.

## Install

1. Install [Npcap](https://npcap.com) (the default options are fine).
2. Download `Nyerk-Setup-<version>.exe` from the
   [latest release](../../releases/latest) and run it. It installs for your Windows account only.
   The installer is not code-signed, so Windows may show "Windows protected your PC": choose
   **More info → Run anyway**.
3. Start the tracker **before you log in** to your character, so it picks up your collection.

The overlay draws over **borderless or windowed** mode, not exclusive fullscreen. The app checks
for updates by itself and asks before installing one.

## Build from source

Needs Windows, [Python 3.12+](https://www.python.org), [Node.js 24](https://nodejs.org) and Npcap.

```bash
python -m venv .venv
```

```bash
.venv\Scripts\python -m pip install -e . pyinstaller
```

```bash
cd app && npm install && npm run dist
```

The installer is written to `app/dist/`. To run without installing, use `npm run build` and then
start Electron from `app/` (`npx electron .`).

## Credits

- Monster names (`data/npcs_en.json`) come from
  [taengu/A2Tools-DPS-Meter](https://github.com/taengu/A2Tools-DPS-Meter), licensed GPL-3.0.
- Pet names, genus, portraits, spawn locations and zone maps come from
  [questlog.gg](https://questlog.gg/aion-2/en/db/pets).
- Aion 2 and its game data and art belong to NCSoft. This project is not affiliated with or
  endorsed by NCSoft or questlog.gg.

## License

[GPL-3.0](LICENSE). It includes GPL-3.0 data from A2Tools-DPS-Meter (see Credits).

## Disclaimer

Use at your own risk. The tracker is passive, but whether third-party tools are allowed is up to
the game's Terms of Service.
