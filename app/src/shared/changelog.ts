/**
 * What changed in each version, newest first: one short line per change (its Spanish in
 * shared/i18n.es.ts), shown on the dashboard's
 * What's new page (the sidebar's App group), and this version's on the Updates page. Add the next
 * version's lines at the top as they land; the release takes them as they are (updates.md).
 */
export interface ChangelogEntry {
  version: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.3.9',
    items: [
      'Where you last died in PvP is marked with a skull on the maps (Map page, map overlay, Map V2), and the kill feed\'s skull opens a small map of it.',
      'The floating icon shows a yellow "!" when a newer version is out (looked up by itself now and then), in place of the session\'s soul count.',
      'Enemies on the map are red when they can attack you (PvP on, or anyone in the Abyss) and grey with their PvP off.',
      'The kill feed has a speaker button to mute or unmute the enemy sound.',"Enemies nearby reads players' PvP right: some with it off were marked PvP (and set off the sound), and a player switching it on in view is marked straight away.",
      'The DPS meter has a button to show or hide the My skills overlay.',
      "The Characters page shows each character's Abyss corridors (Reshanta's Root, Sulfur Tree Island, Archipelago of Siel's Wings): which are still to do since the last reset, on Mondays, Thursdays and Saturdays at 21:00.",
      "Markers on the game's own map: pick the part of the screen where you keep the game's map, and gatherables, your tracked pets' spawns, Hidden Cubes and enemies are drawn on it, following it as you zoom and move it (the new Map V2 page).",
      "The markers on the game's map follow it more surely: the game's own map of your zone at full detail is downloaded the first time you are there and kept (the one the app comes with is used meanwhile).",
      'Gatherables on the maps: ores, gemstones, logs and plants in Verteron and Altgard, as their icons, on the Map page and the map overlay (a switch on each). A new Gatherables page pins the ones you are after, so the maps show only those.',
      'The Map page keeps its switches (Pets you still need, Hidden Cubes, the pets hidden) as you left them.',
      'Resizable map overlay: drag its bottom-right corner (double-click it for the default size). Hovering the map shows a slider for its opacity.',
      'Resizable DPS meter: drag its bottom-right corner (double-click it for the default size). It can also hide itself when no damage has come in for a while (15 s by default), in its settings on the Combat Meter page and in Settings.',
      "The Characters page: every character of your account with its class, level, gear score, combat power and portrait, and their Odyle Energy, Nightmare and Ascension Trial at a glance, read at each login and refilled on the game's schedule in between.",
      'What the game sends as you connect, before the overlay found its connection, is read too: nothing from the login is missed when the overlay opens with the game.'],
  },
  {
    version: '0.3.8',
    items: ['The Spacetime Rift and the daily and weekly resets were an hour off: the rift is now at 2, 5, 8... UTC (17:00 in Buenos Aires) and the resets at 07:00 UTC (04:00 in Buenos Aires).'],
  },
  {
    version: '0.3.7',
    items: [
      'In the Abyss, where everyone fights, the enemy sound plays for every enemy, PvP on or not.',
      'The app is now lokthar-overlay.exe (was Aion2DropTracker.exe). A taskbar pin to the old one needs pinning again; a portable copy of 0.3.6 or older updates by hand this once.',
    ],
  },
  {
    version: '0.3.6',
    items: [
      'Alt+Shift+R starts and stops the packet log from the game, with a pill over the game while it records.',
      'The packet log can be copied while it runs: it is written to disk every second.',
      'Enemies nearby and the PvP log show combat power as soon as a player comes into view.',
      'PvP fight details include your allies\' hits on the enemy and the enemy\'s hits on them.',
      'Alt+E hides the dashboard again when it is open.',
      'PvP fight details show the enemy\'s name in red.',
      'The app is in Spanish (with the community\'s game words), or English: switch on Home or in Settings.',
      'The app opens on Home, with a greeting that knows the time and what is going on.',
      'Enemies nearby marks the players with their PvP on and lists them first; the enemy sound plays only for them (a setting on the PvP page).',
      'Without Npcap, Home says so with a link to download it, and the overlay starts by itself once it is installed.',
    ],
  },
  {
    version: '0.3.5',
    items: [
      'Check for updates now downloads, installs and restarts by itself, the portable copy included.',
      'Updates and What\'s new have their own place in the sidebar.',
    ],
  },
  {
    version: '0.3.4',
    items: [
      'Click your PvP kills and deaths to see the fight: damage, DPS and skills on both sides.',
      'Fights are saved for assists too, when someone else takes the kill.',
      'Enemy players show as red pins on the map overlay.',
      'Fixed: enemies stayed on the Enemies nearby list after leaving or dying.',
      'Players\' classes are read from the skills they use: class icons on kills, enemies and fights.',
    ],
  },
  {
    version: '0.3.3',
    items: [
      'New Enemies nearby overlay: enemy players around you, with class, server and combat power.',
      'Sound alert when an enemy comes into view (Enemy spotted by default).',
      'Your target under the kill feed: class icon, name, server and combat power.',
      'Class icons on the kill feed, the PvP page and the Enemies list.',
      'Kill feed and Enemies: background opacity down to none, with glowing text.',
      'Kill feed and Enemies can be minimized from their header.',
      'All PvP overlay settings are now on the PvP page.',
      'Choose the Hidden Cube sound, test it, or add your own mp3.',
      'Pin as many pets as you like; the HUD shows the first 15 and counts the rest.',
      'Pin or unpin a pet from its own page.',
      'HUD mode (this session or pinned) can be switched from the Pets page.',
      'The map overlay always shows your pinned pets that spawn in your zone.',
      'Pets page: "only in Verteron/Altgard" and "only in Reshanta" labels per faction filter.',
      'Bigger, square map on a pet\'s page.',
      'Fixed: pets jumping to "max" before reaching Lv3.',
      'This What\'s new page.',
    ],
  },
  {
    version: '0.3.2',
    items: [
      'Portable zip: run without installing.',
      'Sync now button for field boss timers.',
      'Field Bosses page shows time left and exact respawn times.',
      'Packet log for debugging, in Settings → Developer.',
    ],
  },
  {
    version: '0.3.1',
    items: [
      'Minimize buttons on the damage meter, map and training overlays.',
      'The dashboard hides when you click back into the game.',
      'Fixed: clicks ignored on the meter and map overlays.',
      'Fixed: the CC overlay could not be dragged.',
      'Centre on me button on the map overlay; the map stays shown when you fly.',
      'Training runs keep a full skill breakdown, with Details.',
    ],
  },
]
