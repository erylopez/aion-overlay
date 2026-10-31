<script setup lang="ts">
// Gatherables: every ore, gemstone, log and plant the maps know, by kind, with how many places each
// has in each zone. Pin the ones you are after and the maps (the Map page and the map overlay) show
// only those; with none pinned they show all. Where to show them at all is switched here too.
import { computed } from 'vue'
import Button from '@/components/Button.vue'
import Toggle from '@/components/Toggle.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { t } from '@/lib/i18n.ts'
import { GATHER_KINDS, useGatherables, type Gatherable } from '@/lib/gatherables.ts'
import { currentWorld, useSpawns } from '@/lib/spawns.ts'
import { useApp } from '@/stores/app.ts'

const store = useApp()
const gather = useGatherables()
const spawns = useSpawns()

const pinned = computed(() => new Set(store.settings.gatherables.pinned))
function togglePin(id: string): void {
  const next = new Set(pinned.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  void store.set('gatherables', { pinned: [...next] })
}
const clearPins = (): void => void store.set('gatherables', { pinned: [] })

const here = computed(() => (spawns.value ? currentWorld(store.nearby, spawns.value) : null))
const zoneName = (id: string): string => spawns.value?.worlds[id]?.name ?? id
/** Its zones, the one you are in first. */
const zonesOf = (g: Gatherable): { id: string; count: number; here: boolean }[] =>
  Object.entries(g.zones)
    .map(([id, points]) => ({ id, count: points.length, here: Number(id) === here.value }))
    .sort((a, b) => Number(b.here) - Number(a.here) || zoneName(a.id).localeCompare(zoneName(b.id)))

const groups = computed(() =>
  GATHER_KINDS.map((k) => ({ ...k, items: (gather.value?.types ?? []).filter((g) => g.kind === k.id) })).filter((k) => k.items.length),
)

const onOverlay = computed(() => store.settings.minimap.gatherables)
const onPage = computed(() => store.settings.mapPage.gatherables)
const setOverlay = (on: boolean): void => void store.set('minimap', { ...store.settings.minimap, gatherables: on })
const setPage = (on: boolean): void => void store.set('mapPage', { ...store.settings.mapPage, gatherables: on })
</script>

<template>
  <div>
    <PageHeader
      title="Gatherables"
      about="Ores, gemstones, logs and plants, and where to find them. Pin the ones you are after and the maps show only those; with none pinned, they show all of them."
    >
      <Button v-if="pinned.size" size="sm" @click="clearPins">{{ t('Unpin all') }}</Button>
    </PageHeader>

    <!-- Where they show. -->
    <div class="mb-6 grid grid-cols-2 gap-3">
      <label
        v-for="o in [
          { on: onOverlay, set: setOverlay, name: t('On the map overlay'), about: t('Around you, over the game.') },
          { on: onPage, set: setPage, name: t('On the Map page'), about: t('Any zone, in this window.') },
        ]"
        :key="o.name"
        :class="['flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition', o.on ? 'border-accent/40 bg-accent-soft/30' : 'border-card bg-card']"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">{{ o.name }}</div>
          <div class="text-xs text-darker">{{ o.about }}</div>
        </div>
        <Toggle :model-value="o.on" @update:model-value="o.set($event)" />
      </label>
    </div>

    <div v-if="!gather" class="py-6 text-center text-sm text-darker">{{ t('Loading…') }}</div>
    <p v-else class="mb-4 text-xs text-darker">
      <template v-if="pinned.size">{{ t('{n} pinned: the maps show only these.', { n: pinned.size }) }}</template>
      <template v-else>{{ t('None pinned: the maps show all of them.') }}</template>
    </p>

    <section v-for="k in groups" :key="k.id" class="mb-6">
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-darker">{{ t(k.label) }}</h2>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
        <button
          v-for="g in k.items"
          :key="g.id"
          type="button"
          :class="[
            'group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
            pinned.has(g.id) ? 'border-accent/50 bg-accent-soft/30' : 'border-card bg-card hover:border-light hover:bg-dark',
            pinned.size && !pinned.has(g.id) && 'opacity-60 hover:opacity-100',
          ]"
          :title="pinned.has(g.id) ? t('Unpin it: the maps stop showing it') : t('Pin it: the maps show it')"
          @click="togglePin(g.id)"
        >
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dark">
            <img :src="g.icon" alt="" draggable="false" class="size-8" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">{{ g.name }}</span>
            <span class="flex flex-wrap gap-x-2 text-[11px] text-darker">
              <span v-for="z in zonesOf(g)" :key="z.id" :class="z.here && 'font-medium text-green'">{{ zoneName(z.id) }} {{ z.count }}</span>
            </span>
          </span>
          <span
            :class="[
              'inline-flex size-7 shrink-0 items-center justify-center rounded-md transition',
              pinned.has(g.id) ? 'text-accent' : 'text-darkest opacity-0 group-hover:opacity-100',
            ]"
          >
            <svg viewBox="0 0 16 16" class="size-3.5" :fill="pinned.has(g.id) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.4">
              <path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6z M8 8.5V14" stroke-linejoin="round" />
            </svg>
          </span>
        </button>
      </div>
    </section>

    <p v-if="gather" class="text-xs text-darkest">{{ t('Only Verteron and Altgard are mapped so far. Places from lokthar.com\'s map ({date}).', { date: gather.imported }) }}</p>
  </div>
</template>
