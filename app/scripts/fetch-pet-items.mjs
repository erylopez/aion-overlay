/**
 * Snapshot which items give which pet: what the Black Cloud Merchant sells, as collection pets.
 *
 *   node scripts/fetch-pet-items.mjs
 *
 * Writes src/renderer/src/data/petItems.json: item id -> pet id, for both kinds of item that matter
 * to the collection. The merchant's stock (`91 56`) names items, not pets; this turns them into
 * the pet ids the collection uses.
 *   pets   "Pet: <name>": unlocks the pet, or gives one soul if it is unlocked already ("If you
 *          already own the pet, it will be obtained as a Soul"); linked by itemRewardsPets
 *   souls  "Soul: <name> (Bound)": one soul; questlog links no pet, so matched by name against
 *          pets.json (fetch-pets.mjs)
 *
 * Source: questlog.gg's item database (global client, `en`): every usable/vehiclesoul item, and
 * each "Pet:" item's itemRewardsPets. Their data, used with credit; a one-time snapshot,
 * sequential requests with a pause between them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(APP, 'src', 'renderer', 'src', 'data', 'petItems.json')
const PETS = join(APP, 'src', 'renderer', 'src', 'data', 'pets.json')
const API = 'https://questlog.gg/aion-2/api/trpc'
const LANGUAGE = 'en'
const HEADERS = { 'user-agent': 'aion2-drop-tracker (personal pet collection tracker)', accept: 'application/json' }
const PAUSE_MS = 250

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(proc, input) {
  const url = `${API}/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return (await res.json()).result.data
}

const filter = { language: LANGUAGE, mainCategory: 'usable', subCategory: 'vehiclesoul' }
const first = await call('database.getItems', { ...filter, page: 1 })
let entries = first.pageData
for (let n = 2; n <= first.pageCount; n++) {
  await sleep(PAUSE_MS)
  entries = entries.concat((await call('database.getItems', { ...filter, page: n })).pageData)
}
entries = entries.filter((e) => e.subCategory === 'vehiclesoul' && !e.isDisabled)

const petByName = new Map(JSON.parse(readFileSync(PETS, 'utf8')).pets.map((p) => [p.name.toLowerCase(), p.id]))
const pets = {}
const souls = {}
const unmatched = []
for (const e of entries) {
  const soulOf = /^Soul: (.+?)(?: \(Bound\))?$/.exec(e.name)?.[1]
  if (soulOf) {
    const pet = petByName.get(soulOf.toLowerCase())
    if (pet) souls[e.id] = pet
    else unmatched.push(`${e.id} ${e.name}`)
    continue
  }
  await sleep(PAUSE_MS)
  const item = await call('database.getItem', { language: LANGUAGE, id: e.id })
  const pet = (item.itemRewardsPets ?? []).find((p) => p.dbType === 'pet')
  if (pet) pets[e.id] = Number(pet.id)
  else unmatched.push(`${e.id} ${e.name}`)
}

mkdirSync(dirname(DATA), { recursive: true })
const out = {
  source: `https://questlog.gg/aion-2/${LANGUAGE}/db/items (usable / vehiclesoul)`,
  fetched: new Date().toISOString().slice(0, 10),
  pets,
  souls,
}
writeFileSync(DATA, JSON.stringify(out, null, 1) + '\n')
console.log(`${Object.keys(pets).length} pet items, ${Object.keys(souls).length} soul items -> ${DATA}`)
if (unmatched.length) console.log(`no pet for: ${unmatched.join('; ')}`)
