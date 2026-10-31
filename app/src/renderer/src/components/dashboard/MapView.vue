<script setup lang="ts">
// Map: a zone's map with you on it (when you are in it), the Hidden Cubes in view, and the spawns
// of the pets you care about: pinned ones and those around you each in their own colour, and,
// optionally, every pet you still need in grey, and the gatherables (the ones pinned on the
// Gatherables page, or all). Any zone can be picked; it opens on yours. Its switches are kept as they
// were left (settings `mapPage`). The map overlay's settings are below it; markers on the game's own
// map are Map V2's.
import { computed, ref, watch } from 'vue'
import Button from '@/components/Button.vue'
import PetIcon from '@/components/PetIcon.vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import WorldMap, { type MapLayer } from '@/components/WorldMap.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import SelectBox from '@/components/ui/SelectBox.vue'
import { gatherLayers, useGatherables } from '@/lib/gatherables.ts'
import { displayName } from '@/lib/petDb.ts'
import { currentWorld, nearbyPets, useSpawns } from '@/lib/spawns.ts'
import { plural, t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import { blankPet, MAX_LEVEL } from '@shared/tracker.ts'
import { SETTINGS_DEFAULTS } from '@shared/settings.ts'

const PALETTE = ['#f76b15', '#30a46c', '#0090ff', '#e54666', '#12a594', '#ab4aba', '#ffc53d', '#ffffff']
const NEEDED = '#a1a1aa'

const store = useApp()
const spawns = useSpawns()
const mini = computed(() => store.settings.minimap)

const here = computed(() => (spawns.value ? currentWorld(store.nearby, spawns.value) : null))
const picked = ref<number | null>(null)
const worldId = computed(() => picked.value ?? here.value ?? (spawns.value ? Number(Object.keys(spawns.value.worlds)[0]) : null))
const world = computed(() => (spawns.value && worldId.value !== null ? (spawns.value.worlds[worldId.value] ?? null) : null))
const zones = computed(() =>
  spawns.value
    ? Object.entries(spawns.value.worlds)
        .map(([id, w]) => ({ id: Number(id), label: `${w.name}${Number(id) === here.value ? ' (you are here)' : ''}` }))
        .sort((a, b) => a.label.localeCompare(b.label))
    : [],
)
const inZone = computed(() => worldId.value !== null && worldId.value === here.value)

const page = computed(() => store.settings.mapPage)
const setPage = (patch: Partial<typeof page.value>): void => void store.set('mapPage', { ...page.value, ...patch })
const showNeeded = computed({ get: () => page.value.needed, set: (needed) => setPage({ needed }) })
const showCubes = computed({ get: () => page.value.cubes, set: (cubes) => setPage({ cubes }) })
const showGather = computed({ get: () => page.value.gatherables, set: (gatherables) => setPage({ gatherables }) })
const gather = useGatherables()
const icons = computed(() => (showGather.value ? gatherLayers(gather.value, worldId.value, store.settings.gatherables.pinned) : []))
const gatherCount = computed(() => icons.value.length)

const pet = (id: number) => store.pets.find((p) => p.id === id) ?? blankPet(id)
/** The pets with spawns in this zone, from a list of ids. */
function withSpawns(ids: number[]): number[] {
  return ids.filter((id) => (spawns.value?.pets[id] ?? []).some((d) => d.worlds.some((w) => w.world === worldId.value)))
}
/** Pinned, then the ones around you: each its colour. */
const tracked = computed(() => {
  if (!spawns.value) return []
  const near = inZone.value ? nearbyPets(store.nearby, spawns.value).map((n) => n.pet) : []
  return withSpawns([...new Set([...store.settings.hud.pinned, ...near])].filter((id) => !store.hiddenPet(id)))
    .slice(0, PALETTE.length)
    .map((id, i) => ({ id, color: PALETTE[i]!, pinned: store.settings.hud.pinned.includes(id) }))
})
/** Tracked pets whose spawns are hidden here (clicked off in the list). */
const hidden = computed(() => new Set(page.value.hiddenPets))
function flip(id: number): void {
  const next = new Set(hidden.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  setPage({ hiddenPets: [...next] })
}
/** Every pet still below the cap with spawns here (not the tracked ones). */
const needed = computed(() => {
  if (!spawns.value || !showNeeded.value) return []
  const trackedIds = new Set(tracked.value.map((t) => t.id))
  return withSpawns(Object.keys(spawns.value.pets).map(Number)).filter((id) => !trackedIds.has(id) && pet(id).level < MAX_LEVEL && !store.hiddenPet(id))
})

const layers = computed<MapLayer[]>(() => {
  const of = (id: number, color: string, active: boolean): MapLayer[] =>
    (spawns.value?.pets[id] ?? []).flatMap((d) => {
      const w = d.worlds.find((x) => x.world === worldId.value)
      return w ? [{ key: `${id}-${d.npc}`, points: w.points, color, active }] : []
    })
  return [
    ...needed.value.flatMap((id) => of(id, NEEDED, false)),
    ...tracked.value.filter((t) => !hidden.value.has(t.id)).flatMap((t) => of(t.id, t.color, true)),
  ]
})
const cubes = computed(() => (inZone.value && showCubes.value ? store.cubes.map((c) => c.position) : []))
const you = computed(() => (inZone.value ? store.nearby.position : null))

// "Find me": the map fits you, once (the map refits whenever focus changes).
const focus = ref<[number, number][]>([])
function findMe(): void {
  if (you.value) focus.value = [you.value]
}
watch(worldId, () => (focus.value = []))

const setMini = (patch: Partial<typeof mini.value>): void => void store.set('minimap', { ...mini.value, ...patch })
const pct = (v: number): string => `${Math.round(v * 100)}%`
</script>

<template>
  <div>
    <PageHeader title="Map" about="Where you are, the Hidden Cubes around you, and where the souls of the pets you are after drop.">
      <SelectBox v-if="zones.length && worldId !== null" :model-value="worldId" :options="zones" @update:model-value="picked = $event" />
      <Button :disabled="!you" @click="findMe">
        <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" /></svg>
        {{ t('Find me') }}
      </Button>
    </PageHeader>

    <div class="mb-6 grid grid-cols-[15rem_1fr] gap-4">
      <aside class="space-y-4 rounded-xl border border-card bg-card p-3 text-sm">
        <div>
          <div class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-darker">{{ t('Tracked pets') }}</div>
          <p v-if="!tracked.length" class="text-xs text-darker">{{ t('Pin pets on the Pets page, or get near their soul monsters, and their spawns show here.') }}</p>
          <button
            v-for="tp in tracked"
            :key="tp.id"
            type="button"
            :class="['flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-dark', hidden.has(tp.id) && 'opacity-40']"
            :title="hidden.has(tp.id) ? t('Show its spawns') : t('Hide its spawns')"
            @click="flip(tp.id)"
          >
            <span class="size-2.5 shrink-0 rounded-full" :style="{ background: tp.color }" />
            <PetIcon :id="tp.id" :size="20" />
            <span class="min-w-0 flex-1 truncate">{{ displayName(pet(tp.id)) }}</span>
            <span class="text-[10px] text-darkest">{{ tp.pinned ? t('pinned') : t('nearby') }}</span>
          </button>
        </div>
        <div class="space-y-2 border-t border-card pt-3">
          <label class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-2"><span class="size-2.5 rounded-full" :style="{ background: NEEDED }" />{{ t('Pets you still need') }}</span>
            <Toggle v-model="showNeeded" />
          </label>
          <label class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-2"><span class="size-2.5 rotate-45 bg-yellow" />Hidden Cubes</span>
            <Toggle v-model="showCubes" />
          </label>
          <label class="flex items-center justify-between gap-2" :title="t('The ones pinned on the Gatherables page, or all of them while none is')">
            <span class="flex items-center gap-2"><img :src="'gather/orichalcum-ore.webp'" alt="" class="size-3.5" />{{ t('Gatherables') }}</span>
            <Toggle v-model="showGather" />
          </label>
          <p v-if="showGather && !gatherCount" class="text-xs text-darkest">{{ t('No gatherables known in this zone yet.') }}</p>
          <p v-if="showNeeded" class="text-xs text-darkest">{{ plural(needed.length, '{n} more pet drops souls in this zone.', '{n} more pets drop souls in this zone.') }}</p>
        </div>
        <div class="border-t border-card pt-3 text-xs text-darker">
          <template v-if="inZone && you">{{ t('You are here: the blue ring.') }}</template>
          <template v-else-if="inZone">{{ t('You are in this zone; where exactly is not known yet.') }}</template>
          <template v-else-if="here !== null">{{ t('You are in {zone}.', { zone: spawns?.worlds[here]?.name ?? t('another zone') }) }}</template>
          <template v-else>{{ t('Where you are is not known yet: it is read as you enter a zone.') }}</template>
        </div>
      </aside>
      <div class="h-[calc(100vh-15rem)] min-h-[420px] overflow-hidden rounded-xl border border-card">
        <WorldMap v-if="world" :world="world" :layers="layers" :focus="focus" :you="you" :cubes="cubes" :icons="icons" />
        <div v-else class="flex h-full items-center justify-center text-sm text-darker">{{ t('Loading maps…') }}</div>
      </div>
    </div>

    <Section title="Map overlay" icon="M1.5 4l4.5-2 4 2 4.5-2v10l-4.5 2-4-2-4.5 2zM6 2v10M10 4v10">
      <SettingRow label="Show the map overlay" hint="A small map over the game that follows you, with your tracked pets' spawns and the Hidden Cubes. Scroll or use + and − to zoom.">
        <Toggle :model-value="mini.enabled" @update:model-value="setMini({ enabled: $event })" />
      </SettingRow>
      <SettingRow v-if="mini.enabled" label="Size" hint="Drag the map's bottom-right corner to resize it; a double-click there resets it.">
        <div class="flex items-center gap-3">
          <span class="text-sm tabular-nums text-dark">{{ mini.size }} × {{ mini.height ?? mini.size }}</span>
          <Button size="sm" :disabled="mini.size === SETTINGS_DEFAULTS.minimap.size && mini.height === null" @click="setMini({ size: SETTINGS_DEFAULTS.minimap.size, height: null })">{{ t('Reset') }}</Button>
        </div>
      </SettingRow>
      <SettingRow v-if="mini.enabled" label="Opacity">
        <Slider :model-value="mini.opacity" :min="0.3" :max="1" :step="0.05" :format="pct" @update:model-value="setMini({ opacity: $event })" />
      </SettingRow>
      <SettingRow v-if="mini.enabled" label="Gatherables" hint="Ores, gemstones, logs and plants around you, as their icons: the ones pinned on the Gatherables page, or all of them while none is.">
        <Toggle :model-value="mini.gatherables" @update:model-value="setMini({ gatherables: $event })" />
      </SettingRow>
    </Section>
  </div>
</template>
