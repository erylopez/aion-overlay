<script setup lang="ts">
// Map V2: markers on the game's own map overlay (main/gameMap.ts). How to set it up first (the
// game's map overlay on, then the part of the screen it is in picked here), then whether the map is
// being followed and on which map, what to draw on it, and a restart for when it stops following.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import SettingRow from '@/components/SettingRow.vue'
import Toggle from '@/components/Toggle.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import { bridge } from '@/lib/bridge.ts'
import { t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import type { GameMapState } from '@shared/gameMap.ts'

const store = useApp()
const api = bridge()
const game = computed(() => store.settings.gameMap)
const setGame = (patch: Partial<typeof game.value>): void => void store.set('gameMap', { ...game.value, ...patch })
const pickRegion = (): void => void api.invoke('gamemap:pick')
const ready = computed(() => game.value.enabled && !!game.value.region)

const state = ref<GameMapState>({ status: 'off', world: null, inliers: 0, ms: 0 })
const STATUS: Record<GameMapState['status'], string> = {
  off: 'Off',
  nomap: 'Your zone is not known yet',
  searching: "Looking for the game's map",
  found: 'On the map',
}
const DETAIL: Record<NonNullable<GameMapState['detail']>, string> = {
  shipped: 'Basic map',
  loading: 'Getting the detailed map…',
  ready: 'Detailed map',
}

/** How the last picture was placed, in words. */
const MODE: Record<string, string> = {
  local: 'Following the map',
  flow: 'Carried by its movement',
  near: 'Found around you',
  zone: 'Found in the zone',
  wait: 'Looking for it',
  error: 'Error',
}
const CAPTURE: Record<NonNullable<GameMapState['capture']>, string> = {
  starting: 'Starting…',
  on: 'Capturing',
  failed: 'Failed (see the map log)',
}
const errorAgo = computed(() => {
  const e = state.value.error
  if (!e) return null
  const s = Math.max(0, Math.round((Date.now() - e.at) / 1000))
  return s < 60 ? t('{n} s ago', { n: s }) : t('{n} min ago', { n: Math.round(s / 60) })
})

// Restart: the overlay comes back in a second or so; the button waits that long.
const restarting = ref(false)
async function restart(): Promise<void> {
  restarting.value = true
  await api.invoke('gamemap:restart')
  setTimeout(() => (restarting.value = false), 1500)
}

let off: (() => void) | null = null
onMounted(async () => {
  off = api.on('gamemap:state', (s) => (state.value = s))
  state.value = await api.invoke('gamemap:get')
})
onBeforeUnmount(() => off?.())

const STEPS = [
  { title: "Open the game's map overlay", body: 'In game, press Shift+Alt+M: the see-through map over the game, the one with Map Opacity and Path Opacity at its top.', key: 'Shift+Alt+M' },
  { title: 'Pick where it is', body: 'Press the button below and drag a box around that map on the screen. Only once: it is kept.', key: null },
  { title: 'Play', body: 'The markers are drawn on it and follow it as you zoom, move it or fly. With the map closed, nothing is drawn.', key: null },
]
</script>

<template>
  <div>
    <PageHeader title="Map V2" about="Markers drawn right on the game's own map: gatherables, your tracked pets' spawns, Hidden Cubes and enemies.">
      <span
        v-if="ready"
        :class="['flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', state.status === 'found' ? 'bg-green/10 text-green' : 'bg-dark text-darker']"
      >
        <span :class="['size-1.5 rounded-full', state.status === 'found' ? 'bg-green' : state.status === 'searching' ? 'animate-pulse bg-yellow' : 'bg-darkest']" />
        {{ t(STATUS[state.status]) }}
      </span>
      <span
        v-if="ready && state.detail && state.status !== 'off'"
        class="rounded-full bg-dark px-2.5 py-0.5 text-xs text-darker"
        :title="t('The game\'s own map of your zone, at full detail, is downloaded once and kept: it is followed more surely than the one the app comes with, which is used meanwhile.')"
      >
        {{ t(DETAIL[state.detail]) }}
      </span>
    </PageHeader>

    <!-- How to set it up. -->
    <ol class="mb-6 grid gap-3 md:grid-cols-3">
      <li v-for="(s, i) in STEPS" :key="s.title" class="flex gap-3 rounded-xl border border-card bg-card px-4 py-3.5">
        <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">{{ i + 1 }}</span>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {{ t(s.title) }}
            <kbd v-if="s.key" class="rounded border border-light bg-dark px-1.5 py-0.5 text-xs font-medium">{{ s.key }}</kbd>
          </div>
          <p class="mt-0.5 text-xs leading-snug text-darker">{{ t(s.body) }}</p>
        </div>
      </li>
    </ol>

    <Section title="On the game's map" icon="M2 2.5h12v11H2zM5 6.5l2 2 4-4M2 10.5h12">
      <SettingRow
        label="Where the game's map is"
        :hint="game.region ? t('Watching {w} × {h} at {x}, {y}.', { w: game.region.width, h: game.region.height, x: game.region.x, y: game.region.y }) : t('Pick where the map is first.')"
      >
        <Button size="sm" :intent="game.region ? 'default' : 'primary'" @click="pickRegion">{{ game.region ? t('Pick again') : t('Pick where the map is') }}</Button>
      </SettingRow>
      <SettingRow label="Show markers on the game's map">
        <Toggle :model-value="ready" :disabled="!game.region" @update:model-value="setGame({ enabled: $event })" />
      </SettingRow>
      <SettingRow v-if="ready" label="Show the watched area" hint="A dashed border around the part of the screen the overlay watches, to check it lies on the game's map: blue while looking, green once the map is found.">
        <Toggle :model-value="game.showArea" @update:model-value="setGame({ showArea: $event })" />
      </SettingRow>
      <SettingRow
        v-if="ready"
        label="Stopped following the map?"
        hint="It looks for the map again by itself (around you every half second, the whole zone every few seconds). If it still does not show, this starts it over: a new picture of the screen and a new search. If you moved or resized the game's map, pick its place again instead."
      >
        <Button size="sm" :loading="restarting" @click="restart">
          <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" /></svg>
          {{ t('Restart') }}
        </Button>
      </SettingRow>
    </Section>

    <Section v-if="ready" title="What the overlay sees" icon="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z">
      <div class="flex gap-4 py-3">
        <div class="flex size-[180px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-card bg-dark">
          <img v-if="state.preview" :src="state.preview" alt="" class="max-h-full max-w-full" draggable="false" />
          <span v-else class="px-3 text-center text-xs text-darkest">{{ t('Nothing yet: is the game open, with the markers on?') }}</span>
        </div>
        <dl class="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1.5 text-sm">
          <dt class="text-darker">{{ t('Screen capture') }}</dt>
          <dd :class="state.capture === 'failed' ? 'text-danger' : state.capture === 'on' ? 'text-green' : ''">
            {{ state.capture ? t(CAPTURE[state.capture]) : '–' }}<span v-if="state.pictures" class="text-darker"> · {{ t('{n} pictures', { n: state.pictures }) }}</span>
          </dd>
          <dt class="text-darker">{{ t('Now') }}</dt>
          <dd>{{ state.mode ? t(MODE[state.mode] ?? state.mode) : '–' }}</dd>
          <dt class="text-darker">{{ t('Points that agree') }}</dt>
          <dd class="tabular-nums">{{ state.inliers || '–' }}</dd>
          <dt class="text-darker">{{ t('Time per picture') }}</dt>
          <dd class="tabular-nums">{{ state.ms ? `${state.ms} ms` : '–' }}</dd>
          <dt class="text-darker">{{ t('Last problem') }}</dt>
          <dd :class="state.error ? 'text-danger' : 'text-darkest'">
            <template v-if="state.error">{{ state.error.text }} <span class="text-darker">· {{ errorAgo }}</span></template>
            <template v-else>{{ t('none') }}</template>
          </dd>
        </dl>
      </div>
      <div class="flex items-center gap-4 border-t border-card py-3">
        <p class="min-w-0 flex-1 text-xs text-darker">
          {{ t("If the picture is not the game's map (black, another part of the screen), pick its place again. If it is the map and nothing matches, or the screen capture fails, send the map log.") }}
        </p>
        <Button size="sm" @click="api.invoke('gamemap:openLog')">
          <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5.5L12.5 4.5v10H4zM9 1.5v3.5h3.5M6 8h4.5M6 10.5h4.5" /></svg>
          {{ t('Open the map log') }}
        </Button>
      </div>
    </Section>

    <Section v-if="ready" title="What to draw" icon="M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z">
      <SettingRow label="Gatherables" hint="The ones pinned on the Gatherables page, or all of them while none is.">
        <Toggle :model-value="game.gatherables" @update:model-value="setGame({ gatherables: $event })" />
      </SettingRow>
      <SettingRow label="Tracked pets' spawns" hint="Pinned pets, and the ones whose soul monsters are around you, each in its colour.">
        <Toggle :model-value="game.pets" @update:model-value="setGame({ pets: $event })" />
      </SettingRow>
      <SettingRow label="Hidden Cubes" hint="The ones in view.">
        <Toggle :model-value="game.cubes" @update:model-value="setGame({ cubes: $event })" />
      </SettingRow>
      <SettingRow label="Enemies" hint="Enemy players in view, with their names.">
        <Toggle :model-value="game.enemies" @update:model-value="setGame({ enemies: $event })" />
      </SettingRow>
    </Section>

    <p class="text-xs text-darkest">
      {{ t('The markers stay out of screen recordings and screenshots (they have to, to find the map). While the packet log is on (Settings → Developer), Shift+Alt+M adds a mark there instead of reaching the game.') }}
    </p>
  </div>
</template>
