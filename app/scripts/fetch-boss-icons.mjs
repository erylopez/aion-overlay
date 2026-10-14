/**
 * The field bosses' portraits, for the Timers tab: src/renderer/public/bosses/<list id>.webp.
 *
 *   node scripts/fetch-boss-icons.mjs [--force]
 *
 * Each boss of FIELD_BOSSES (src/shared/timers.ts) is found by name among questlog.gg's `named`
 * map markers of its zone, which gives its monster id; the monster's record gives its portrait.
 * Writes src/renderer/src/data/fieldBossNpcs.json (list id -> monster id) for reference. Images
 * already present are kept unless --force. Re-run when bosses are added.
 *
 * Source: questlog.gg's Aion 2 database and map (global client, `en`), used with credit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const TIMERS = join(APP, 'src', 'shared', 'timers.ts')
const OUT = join(APP, 'src', 'renderer', 'public', 'bosses')
const NPCS = join(APP, 'src', 'renderer', 'src', 'data', 'fieldBossNpcs.json')
const API = 'https://questlog.gg/aion-2/api/trpc'
const CDN = 'https://cdn.questlog.gg/aion-2'
const HEADERS = { 'user-agent': 'aion2-drop-tracker (personal pet collection tracker)', accept: 'application/json' }
const force = process.argv.includes('--force')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function trpc(proc, input) {
  const res = await fetch(`${API}/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`${proc}: HTTP ${res.status}`)
  return (await res.json()).result.data
}

// The bosses as timers.ts lists them: { boss: 101001, name: 'Neikel of the East' }.
const src = readFileSync(TIMERS, 'utf8')
const bosses = [...src.matchAll(/\{ boss: (\d+), name: (['"])(.+?)\2 \}/g)].map((m) => ({ boss: Number(m[1]), name: m[3] }))
console.log(`${bosses.length} bosses in timers.ts`)

console.log('map markers (one large download)…')
const markers = (await trpc('map.getMarkers', { language: 'en' })).filter((m) => m.mapCategory === 'named')

mkdirSync(OUT, { recursive: true })
const npcs = {}
for (const b of bosses) {
  const world = String(Math.floor(b.boss / 100))
  const m = markers.find((x) => x.mapWorldId === world && x.name === b.name)
  if (!m) {
    console.warn(`  ${b.boss} ${b.name}: no named marker in world ${world}`)
    continue
  }
  npcs[b.boss] = Number(m.dbId)
  const file = join(OUT, `${b.boss}.webp`)
  if (existsSync(file) && !force) continue
  await sleep(300)
  const npc = await trpc('database.getNpc', { id: String(m.dbId), language: 'en' })
  if (!npc.icon) {
    console.warn(`  ${b.boss} ${b.name}: no portrait`)
    continue
  }
  const res = await fetch(`${CDN}${npc.icon.replace(/\.[^/]+$/, '')}.webp`)
  if (!res.ok) {
    console.warn(`  ${b.boss} ${b.name}: portrait HTTP ${res.status}`)
    continue
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  console.log(`  ${b.boss} ${b.name} (monster ${m.dbId})`)
}
writeFileSync(NPCS, JSON.stringify({ source: 'https://questlog.gg/aion-2/en/map', fetched: new Date().toISOString().slice(0, 10), npcs }, null, 2) + '\n')
console.log(`${Object.keys(npcs).length}/${bosses.length} matched`)
