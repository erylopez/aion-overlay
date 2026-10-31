/**
 * Snapshot where every gatherable resource is (ores, gemstones, logs, plants), with its icon, from
 * Lokthar's site map (lokthar.com/aion2/map, its data imported from interactivemap.app).
 *
 *   node scripts/import-gatherables.mjs <lokthar>/public/aion2-map
 *
 * Writes src/renderer/public/maps/gatherables.json and the icons, 48 px, in
 * src/renderer/public/gather/<id>.webp (needs ImageMagick's `magick`). Run fetch-spawns.mjs
 * first: the zones and their coordinates come from its spawns.json.
 *
 * Coordinates: the site's map images are the same pictures as questlog.gg's (spawns.json `key`),
 * framed the same, at 4096 px. A marker's `position` is [row, column] on it, so on the image
 * u = column / 4096 and v = row / 4096, and in the game's coordinates (spawns.json `sectors`
 * [x0, y0, nx, ny, size]) x = x0 + u * nx * size and y = y0 + (1 - v) * ny * size. Checked
 * against the pets' spawns: the site's monsters land a median 333 units (about a pixel) from
 * questlog.gg's in Verteron.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(APP, 'src', 'renderer', 'public')
const SOURCE = process.argv[2]
if (!SOURCE) {
  console.error('usage: node scripts/import-gatherables.mjs <lokthar>/public/aion2-map')
  process.exit(1)
}
const IMAGE = 4096
const ICON_PX = 48

/** What kind each resource is, for grouping (by name; anything else gathered is a plant). */
const kind = (name) => (/gemstone/i.test(name) ? 'gem' : /ore|odyle/i.test(name) ? 'ore' : /log$/i.test(name) ? 'log' : 'plant')
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const spawns = JSON.parse(readFileSync(join(PUBLIC, 'maps', 'spawns.json'), 'utf8'))
const worldByName = new Map(Object.entries(spawns.worlds).map(([id, w]) => [w.name, Number(id)]))

/** id -> { id, name, kind, icon, zones: { world: [[x, y], ...] } } */
const types = new Map()
mkdirSync(join(PUBLIC, 'gather'), { recursive: true })
for (const map of ['1', '2', '3']) {
  const index = JSON.parse(readFileSync(join(SOURCE, 'data', map, 'index.json'), 'utf8'))
  const world = worldByName.get(index.name)
  const resources = index.groups.find((g) => g.name === 'Resources')
  if (!resources) continue
  if (world === undefined) throw new Error(`${index.name}: no zone of that name in spawns.json`)
  const [x0, y0, nx, ny, size] = spawns.worlds[world].sectors
  for (const category of resources.categories) {
    const id = slug(category.name)
    const markers = JSON.parse(readFileSync(join(SOURCE, 'data', map, category.file), 'utf8'))
    const points = markers.map(({ position: [row, col] }) => [
      Math.round(x0 + (col / IMAGE) * nx * size),
      Math.round(y0 + (1 - row / IMAGE) * ny * size),
    ])
    if (!types.has(id)) {
      execFileSync('magick', [join(SOURCE, 'icons', category.icon), '-resize', `${ICON_PX}x${ICON_PX}`, '-quality', '90', join(PUBLIC, 'gather', `${id}.webp`)])
      types.set(id, { id, name: category.name, kind: kind(category.name), icon: `gather/${id}.webp`, zones: {} })
    }
    types.get(id).zones[world] = points
    console.log(`${index.name}: ${category.name}, ${points.length}`)
  }
}

const KINDS = ['ore', 'gem', 'log', 'plant']
const list = [...types.values()].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.name.localeCompare(b.name))
writeFileSync(
  join(PUBLIC, 'maps', 'gatherables.json'),
  JSON.stringify({ source: 'lokthar.com/aion2/map (from interactivemap.app)', imported: new Date().toISOString().slice(0, 10), types: list }),
)
console.log(`${list.length} gatherables`)
