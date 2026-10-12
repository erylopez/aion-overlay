<script setup lang="ts">
// Every pet: search, sort, filter. Click a name or a soul count to correct it; the pin puts a pet
// on the HUD (in pinned mode).
import { computed, nextTick, onBeforeUnmount, ref, toRefs } from 'vue'
import GenusPill, { GENUS_PILL } from '@/components/GenusPill.vue'
import LevelBadge from '@/components/LevelBadge.vue'
import LevelBar from '@/components/LevelBar.vue'
import PetIcon from '@/components/PetIcon.vue'
import { bridge } from '@/lib/bridge.ts'
import { CONTINENTS, formatDistance, nearbyPets, petContinents, petDistance, useSpawns, type NearbyPet } from '@/lib/spawns.ts'
import { displayName, GENERA, GENUS_LABEL, monsterName, PET_DB_DATE, PET_DB_SIZE, PET_DB_SOURCE, petInfo, type Genus } from '@/lib/petDb.ts'
import { useApp } from '@/stores/app.ts'
import { blankPet, MAX_LEVEL, nextLevelSouls, type Pet } from '@shared/tracker.ts'

const store = useApp()
// In the store, so they survive the tab being rebuilt (after a pet's map closes).
const { query, sort, filter, genus, continent } = toRefs(store.collectionView)

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unfinished', label: `Below Lv${MAX_LEVEL}` },
  { id: 'session', label: 'This session' },
  { id: 'pinned', label: 'Pinned' },
] as const

// Around you: the pets whose soul monsters the tracker sees loaded near you.
const spawns = useSpawns()

/** The continents each pet's soul monsters spawn on (Elyos, Asmodian, Abyss). */
const continents = computed(() => (spawns.value ? petContinents(spawns.value) : new Map<number, Set<string>>()))
const onContinent = (id: number): boolean => !continent.value || !!continents.value.get(id)?.has(continent.value)
const ofGenus = (id: number): boolean => !genus.value || petInfo(id)?.genus === genus.value

/** Pets per genus on the chosen continent, for the genus chips. */
const genusCounts = computed(() => {
  const counts = new Map<Genus, number>()
  for (const p of store.pets) {
    const g = petInfo(p.id)?.genus
    if (g && onContinent(p.id)) counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  return counts
})
/** Pets per continent of the chosen genus, for the continent chips. */
const continentCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const p of store.pets) {
    if (!ofGenus(p.id)) continue
    for (const c of continents.value.get(p.id) ?? []) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return counts
})

/**
 * Range: how far your last known position is from each pet's nearest soul monster spawn in your
 * zone. The tracker learns the position on entering a zone, teleporting, and from your own skills;
 * null for a pet with no spawns in your zone, or while the position is not known.
 */
const here = computed(() =>
  store.nearby.world !== null && store.nearby.position ? { world: store.nearby.world, at: store.nearby.position } : null,
)
// How old the position is, said the way people do; ticks so it ages while the panel is open.
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 15_000)
onBeforeUnmount(() => clearInterval(ticker))
const positionAge = computed(() => {
  const at = store.nearby.positionAt
  if (!at) return 'as last seen'
  const min = Math.floor((now.value - at) / 60_000)
  return min < 1 ? 'updated just now' : min < 60 ? `updated ${min} min ago` : `updated ${Math.floor(min / 60)} h ago`
})
const distance = (id: number): number | null =>
  spawns.value && here.value ? petDistance(spawns.value, id, here.value.world, here.value.at) : null
const near = computed(
  () =>
    new Map<number, NearbyPet>(
      (spawns.value ? nearbyPets(store.nearby, spawns.value) : []).filter((n) => !store.hiddenPet(n.pet)).map((n) => [n.pet, n]),
    ),
)
/** The soul monsters around you, by name: what you actually see in the game. */
const nearMonsters = computed(() => {
  const seen = new Map<number, { name: string; count: number }>()
  for (const n of near.value.values()) for (const m of n.monsters) seen.set(m.npc, { name: m.name, count: m.count })
  return [...seen.values()].sort((a, b) => b.count - a.count)
})
const nearLine = (n: NearbyPet): string =>
  n.monsters.map((m) => `${m.count > 1 ? `${m.count}× ` : ''}${m.name} (Lv${m.level})`).join(', ')

const pinned = computed(() => new Set(store.settings.hud.pinned))
const list = computed(() => {
  const q = query.value.trim().toLowerCase()
  // A pet nearby that the collection has never seen (no souls yet) still belongs in the list.
  const known = new Set(store.pets.map((p) => p.id))
  const unseen: Pet[] = [...near.value.keys()]
    .filter((id) => !known.has(id))
    .map((id) => blankPet(id))
  let out = [...store.pets, ...(filter.value === 'nearby' ? unseen : [])].filter((p) => {
    // Maxed pets are left out when the setting says so, unless searched for by name.
    if (!q && store.hiddenPet(p.id)) return false
    if (filter.value === 'nearby' && !near.value.has(p.id)) return false
    if (filter.value === 'pinned' && !pinned.value.has(p.id)) return false
    if (filter.value === 'unfinished' && p.level >= MAX_LEVEL) return false
    if (filter.value === 'session' && !p.session) return false
    const info = petInfo(p.id)
    if (!ofGenus(p.id) || !onContinent(p.id)) return false
    if (!q) return true
    const haystack = [displayName(p), p.name ?? '', info ? GENUS_LABEL[info.genus] : '', String(p.id)]
    return haystack.some((h) => h.toLowerCase().includes(q))
  })
  const by: Record<typeof sort.value, (a: Pet, b: Pet) => number> = {
    souls: (a, b) => b.souls - a.souls,
    name: (a, b) => displayName(a).localeCompare(displayName(b)),
    level: (a, b) => b.level - a.level || b.souls - a.souls,
    recent: (a, b) => b.session - a.session || b.souls - a.souls,
    // Nearest first; pets with no spawn in your zone after them, by souls.
    range: (a, b) => {
      const da = distance(a.id)
      const db = distance(b.id)
      if (da !== null && db !== null) return da - db
      return (da === null ? 1 : 0) - (db === null ? 1 : 0) || b.souls - a.souls
    },
  }
  const nearFirst = (a: Pet, b: Pet): number =>
    filter.value === 'nearby' ? (near.value.get(b.id)?.count ?? 0) - (near.value.get(a.id)?.count ?? 0) : 0
  out = [...out].sort((a, b) => nearFirst(a, b) || by[sort.value](a, b) || a.id - b.id)
  return out
})
const hiddenCount = computed(() => (query.value.trim() ? 0 : store.pets.filter((p) => store.hiddenPet(p.id)).length))
const totals = computed(() => ({
  pets: store.pets.length,
  souls: store.pets.reduce((n, p) => n + p.souls, 0),
  maxed: store.pets.filter((p) => p.level >= MAX_LEVEL).length,
}))

// Inline editing: one field at a time.
const editing = ref<{ id: number; field: 'name' | 'souls'; value: string } | null>(null)
const input = ref<HTMLInputElement[] | null>(null)
async function edit(pet: Pet, field: 'name' | 'souls'): Promise<void> {
  editing.value = { id: pet.id, field, value: field === 'name' ? (pet.name ?? '') : String(pet.souls) }
  await nextTick()
  input.value?.[0]?.select()
}
function commit(): void {
  const e = editing.value
  editing.value = null
  if (!e) return
  if (e.field === 'souls') {
    const n = Number(e.value)
    if (Number.isInteger(n) && n >= 0) void bridge().invoke('tracker:setSouls', e.id, n)
  } else if (e.value.trim()) {
    void bridge().invoke('tracker:setName', e.id, e.value.trim())
  }
}

const syncedAgo = computed(() => {
  const s = store.status?.synced
  if (!s) return null
  const min = Math.round((Date.now() - s.at) / 60000)
  return min < 1 ? 'just now' : `${min} min ago`
})
</script>

<template>
  <div class="space-y-3 p-3">
    <div
      v-if="!store.status?.synced && store.pets.every((p) => p.levelEstimated)"
      class="rounded-lg border border-accent/40 bg-accent-soft/60 px-3 py-2 text-xs leading-relaxed text-dark"
    >
      Counts load from the server when you enter the world. Log in (or go to character select and back) while the
      tracker runs to sync every pet.
    </div>

    <button
      type="button"
      :class="[
        'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition',
        filter === 'nearby' ? 'border-green/60 bg-green/10' : 'border-card bg-card hover:border-light',
      ]"
      :title="filter === 'nearby' ? 'Show all pets' : 'Show the pets whose soul monsters are around you'"
      @click="filter = filter === 'nearby' ? 'all' : 'nearby'"
    >
      <span :class="['size-2 shrink-0 rounded-full', near.size ? 'bg-green shadow-[0_0_6px] shadow-green' : 'bg-darkest']" />
      <span class="font-semibold">Nearby</span>
      <span v-if="near.size" class="min-w-0 truncate text-xs text-darker">
        {{ nearMonsters.slice(0, 3).map((m) => `${m.name} ${m.count}`).join(' · ') }}
      </span>
      <span v-else class="text-xs text-darkest">no soul monsters around you</span>
      <span class="ml-auto shrink-0 rounded-full bg-green/15 px-2 text-xs font-semibold tabular-nums text-green">{{ near.size }}</span>
    </button>

    <div class="grid grid-cols-3 gap-2 text-center">
      <div class="rounded-lg bg-card px-2 py-1.5">
        <div class="text-lg font-semibold tabular-nums">{{ totals.pets }}</div>
        <div class="text-[11px] text-darker">pets</div>
      </div>
      <div class="rounded-lg bg-card px-2 py-1.5">
        <div class="text-lg font-semibold tabular-nums">{{ totals.souls }}</div>
        <div class="text-[11px] text-darker">souls</div>
      </div>
      <div class="rounded-lg bg-card px-2 py-1.5">
        <div class="text-lg font-semibold tabular-nums">{{ totals.maxed }}</div>
        <div class="text-[11px] text-darker">at Lv{{ MAX_LEVEL }}</div>
      </div>
    </div>
    <p v-if="syncedAgo" class="-mt-1 text-right text-[11px] text-darkest">synced from the server {{ syncedAgo }}</p>

    <div class="flex gap-2">
      <input
        v-model="query"
        type="search"
        placeholder="Search pets, monsters, genus or #id"
        class="h-8 min-w-0 flex-1 rounded-md border border-light bg-default px-2.5 text-sm placeholder:text-darkest focus:border-accent"
      />
      <select v-model="sort" class="h-8 rounded-md border border-light bg-default px-2 text-sm" title="Sort">
        <option value="souls">Most souls</option>
        <option value="level">Level</option>
        <option value="name">Name</option>
        <option value="recent">This session</option>
        <option value="range">Range</option>
      </select>
    </div>
    <!-- The filters, one segment per group: what to show, then genus, then continent. -->
    <div class="divide-y divide-[color:var(--gray-4)] rounded-lg border border-card bg-card">
      <div class="flex items-start gap-2 px-2.5 py-2">
        <span class="w-16 shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-wide text-darkest">Show</span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="f in FILTERS"
            :key="f.id"
            type="button"
            :class="[
              'rounded-full border px-2.5 py-0.5 text-xs transition',
              filter === f.id ? 'border-accent bg-accent-soft text-accent' : 'border-light text-darker hover:text-default',
            ]"
            @click="filter = f.id"
          >
            {{ f.label }}
          </button>
        </div>
      </div>
      <div class="flex items-start gap-2 px-2.5 py-2">
        <span class="w-16 shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-wide text-darkest">Genus</span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="g in GENERA"
            :key="g.id"
            type="button"
            :class="[
              'rounded-full border px-2.5 py-0.5 text-xs transition',
              genus === g.id ? GENUS_PILL[g.id] : 'border-light text-darker hover:text-default',
            ]"
            @click="genus = genus === g.id ? null : g.id"
          >
            {{ g.label }} <span class="tabular-nums opacity-60">{{ genusCounts.get(g.id) ?? 0 }}</span>
          </button>
        </div>
      </div>
      <div class="flex items-start gap-2 px-2.5 py-2">
        <span class="w-16 shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-wide text-darkest">Continent</span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="c in CONTINENTS"
            :key="c.id"
            type="button"
            :class="[
              'rounded-full border px-2.5 py-0.5 text-xs transition',
              continent === c.id ? 'border-accent bg-accent-soft text-accent' : 'border-light text-darker hover:text-default',
            ]"
            :title="`Pets whose soul monsters spawn in ${c.label === 'Abyss' ? 'the Abyss' : `${c.label} zones`}`"
            @click="continent = continent === c.id ? null : c.id"
          >
            {{ c.label }} <span class="tabular-nums opacity-60">{{ continentCounts.get(c.id) ?? 0 }}</span>
          </button>
        </div>
      </div>
    </div>
    <p v-if="sort === 'range' && !here" class="-mt-1 text-[11px] text-darkest">
      Range needs your position: the tracker learns it when you enter a zone, teleport or fight.
    </p>
    <p v-else-if="sort === 'range' && here" class="-mt-1 text-[11px] text-darkest">
      Range from your position in {{ spawns?.worlds[here.world]?.name ?? 'this zone' }}, {{ positionAge }}. It updates
      when you enter a zone, teleport or fight.
    </p>

    <ul class="divide-y divide-[color:var(--gray-4)] overflow-hidden rounded-lg border border-card bg-card">
      <li
        v-for="pet in list"
        :key="pet.id"
        class="group flex cursor-pointer gap-2.5 px-3 py-2 transition hover:bg-dark"
        title="Show where its souls drop"
        @click="store.openPet(pet.id)"
      >
        <PetIcon :id="pet.id" :size="38" class="mt-0.5" />
        <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <div class="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              v-if="editing?.id === pet.id && editing.field === 'name'"
              ref="input"
              v-model="editing.value"
              class="h-6 w-full rounded border border-accent bg-default px-1.5 text-sm"
              placeholder="Monster name"
              @click.stop
              @keydown.enter="commit"
              @keydown.esc.stop="editing = null"
              @blur="commit"
            />
            <template v-else>
              <!-- A pet the database knows has its name; only an unknown one is named by hand. -->
              <span v-if="petInfo(pet.id)" class="truncate text-sm font-medium" :title="`Pet #${pet.id}`">
                {{ displayName(pet) }}
              </span>
              <button
                v-else
                type="button"
                :class="['truncate text-left text-sm', pet.name ? 'font-medium' : 'italic text-darker']"
                title="Not in the pet database: click to name it"
                @click.stop="edit(pet, 'name')"
              >
                {{ displayName(pet) }}
              </button>
              <GenusPill :id="pet.id" />
            </template>
          </div>
          <span v-if="pet.session" class="text-xs tabular-nums text-green">+{{ pet.session }}</span>
          <input
            v-if="editing?.id === pet.id && editing.field === 'souls'"
            ref="input"
            v-model="editing.value"
            inputmode="numeric"
            class="h-6 w-14 rounded border border-accent bg-default px-1.5 text-right text-sm tabular-nums"
            @click.stop
              @keydown.enter="commit"
            @keydown.esc.stop="editing = null"
            @blur="commit"
          />
          <button
            v-else
            type="button"
            class="w-10 text-right text-sm font-semibold tabular-nums hover:text-accent"
            title="Click to correct the count"
            @click.stop="edit(pet, 'souls')"
          >
            {{ pet.souls }}
          </button>
          <LevelBadge :pet="pet" />
          <button
            type="button"
            :title="pinned.has(pet.id) ? 'Unpin from the HUD' : 'Pin to the HUD'"
            :class="[
              'flex size-6 items-center justify-center rounded transition',
              pinned.has(pet.id) ? 'text-accent' : 'text-darkest opacity-0 hover:text-default group-hover:opacity-100',
            ]"
            @click.stop="store.togglePin(pet.id)"
          >
            <svg viewBox="0 0 16 16" class="size-3.5" :fill="pinned.has(pet.id) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.4">
              <path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6z M8 8.5V14" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        <div v-if="near.get(pet.id)" class="truncate text-[11px] text-green" :title="nearLine(near.get(pet.id)!)">
          nearby: {{ nearLine(near.get(pet.id)!) }}
        </div>
        <div v-else-if="monsterName(pet) || (sort === 'range' && distance(pet.id) !== null)" class="truncate text-[11px] text-darkest">
          <template v-if="sort === 'range' && distance(pet.id) !== null">{{ formatDistance(distance(pet.id)!) }} away</template>
          <template v-if="sort === 'range' && distance(pet.id) !== null && monsterName(pet)"> · </template>
          <template v-if="monsterName(pet)">from {{ monsterName(pet) }}</template>
        </div>
        <div class="mt-1 flex items-center gap-2">
          <LevelBar :pet="pet" class="flex-1" />
          <span class="w-20 text-right text-[11px] tabular-nums text-darkest">
            <template v-if="nextLevelSouls(pet) !== null">{{ pet.souls }} / {{ nextLevelSouls(pet) }}</template>
            <template v-else>max{{ pet.crystals ? ` · ${pet.crystals} crystals` : '' }}</template>
          </span>
        </div>
        </div>
      </li>
      <li v-if="hiddenCount" class="px-3 py-2 text-center text-[11px] text-darkest">
        {{ hiddenCount }} maxed (Lv3) pet{{ hiddenCount === 1 ? '' : 's' }} hidden: search finds them, or turn this off in Settings.
      </li>
      <li v-if="!list.length" class="px-3 py-6 text-center text-sm text-darker">
        {{ store.pets.length ? 'No pets match.' : 'No pets yet: they appear when souls drop, or on the next login sync.' }}
      </li>
    </ul>
    <p class="text-center text-[11px] text-darkest">
      Pet names, genus and portraits:
      <a :href="PET_DB_SOURCE" target="_blank" class="hover:text-default hover:underline">questlog.gg</a>
      ({{ PET_DB_SIZE }} pets, {{ PET_DB_DATE }})
    </p>
  </div>
</template>
