<script setup lang="ts">
// The DPS meter, in a window of its own: open while the game is (and the meter is on), moved by its
// header, sized to its rows. questlog.gg's layout: the fight's time and total, the target's HP with
// how long until it dies, then a row per player in their class colour (DPS, share, damage, crit).
// Hovering shows the switches: which targets, which players, and damage, healing or damage taken.
// The minimize button shrinks it to its title line, with the total per second. Its bottom-right
// corner resizes it (a double-click there goes back to the default size); with "hide while idle" on
// it hides after that long with nothing new on it, and comes back with the next hit.
// The numbers are the engine's (A2Tools DPS Meter's parser); the class icons and colours are its too.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CollapseButton from '@/components/CollapseButton.vue'
import ResizeGrip from '@/components/ResizeGrip.vue'
import { bridge } from '@/lib/bridge.ts'
import { clampTo, cornerResize } from '@/lib/cornerResize.ts'
import { t } from '@/lib/i18n.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import {
  CLASS_COLORS,
  MAIN_TARGET_MODES,
  METER_PLAYERS,
  METER_STATS,
  meterRows,
  NO_METER,
  TARGET_MODE_LABELS,
  timeToKill,
  type MeterData,
  type MeterPlayers,
  type MeterStat,
  type TargetMode,
} from '@shared/meter.ts'
import { METER_HEIGHT, METER_WIDTH } from '@shared/settings.ts'
import type { TrackerState } from '@shared/tracker.ts'

const store = useApp()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.meter)
const api = bridge()

const meter = ref<MeterData>(NO_METER)
/** The engine's state: the meter and the tracker are the same process. */
const status = computed(() => store.status ?? { state: 'starting' as TrackerState, detail: null })

const icons = import.meta.glob<string>('@/assets/classes/*.png', { eager: true, import: 'default' })
const icon = (className: string | null): string | null =>
  className ? (icons[`/src/assets/classes/${className.toLowerCase()}.png`] ?? null) : null

const all = computed(() => meterRows(meter.value, cfg.value.players, cfg.value.stat))
/** A height of its own shows every row it fits (scrolling past them); otherwise as many as set. */
const rows = computed(() => all.value.slice(0, height.value === null ? cfg.value.rows : 24))
const top = computed(() => Math.max(1, ...all.value.map((r) => r.value)))
const total = computed(() => all.value.reduce((n, r) => n + r.value, 0))
const totalPerSecond = computed(() => all.value.reduce((n, r) => n + r.perSecond, 0))
const ttk = computed(() => timeToKill(meter.value))
const STAT_TITLE: Record<MeterStat, [string, string, string]> = {
  damage: ['Damage Meter', 'Total damage', 'DPS'],
  healing: ['Healing', 'Total healing', 'HPS'],
  taken: ['Damage Taken', 'Total taken', 'per s'],
}

/** 1234 → 1.2K, 1234567 → 1.23M */
function short(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString('en-US')
}
const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const hpShare = computed(() => {
  const t = meter.value.target
  return t && t.maxHp > 0 && t.hp !== null ? Math.min(1, Math.max(0, t.hp / t.maxHp)) : null
})

const STATUS_TEXT: Record<TrackerState, string> = {
  starting: 'Starting…',
  listening: 'Looking for the game connection…',
  locked: 'Waiting for a fight',
  idle: 'Asleep until Aion 2 starts',
  stopped: 'Replay finished',
  error: 'Error',
  exited: 'Restarting…',
}
const statusDot = computed(
  () =>
    ({ locked: 'bg-green', listening: 'bg-yellow', starting: 'bg-yellow', exited: 'bg-yellow', error: 'bg-danger', idle: 'bg-darkest', stopped: 'bg-darkest' })[
      status.value.state
    ],
)
const empty = computed(() => {
  if (status.value.state === 'error' || status.value.state === 'exited') return status.value.detail ?? t(STATUS_TEXT[status.value.state])
  if (status.value.state === 'locked' && !meter.value.meKnown) return t('Detecting character… change zone or log in so the meter knows who you are.')
  if (meter.value.rows.length) return cfg.value.players === 'me' ? t('None of your damage on this target.') : t('Nothing of this on the target yet.')
  return t(STATUS_TEXT[status.value.state])
})

const drag = windowDrag({ move: 'meter:moveTo', end: 'meter:dragEnd' })
const reset = (): void => void api.invoke('meter:reset')
/** A row's skills, in the Details window: the live target's, following the fight. */
function showDetails(actor: number): void {
  const target = meter.value.target?.id
  if (target) void api.invoke('details:open', { kind: 'live', target, actor })
}
/** Your ping, coloured by how it plays: under 80 ms good, under 150 ms fair. */
const pingClass = computed(() => {
  const ms = meter.value.ping
  return ms === null ? '' : ms < 80 ? 'text-green' : ms < 150 ? 'text-yellow' : 'text-danger'
})
const set = (patch: Partial<typeof cfg.value>): void => void store.set('meter', { ...cfg.value, ...patch })
/** The My skills overlay (your skills on the meter's target), on or off from here too. */
const skillsOn = computed(() => store.settings.skills.enabled)
const toggleSkills = (): void => void store.set('skills', { ...store.settings.skills, enabled: !skillsOn.value })

/** The size while its corner is being dragged; the saved one otherwise. */
const live = ref<{ width: number; height: number | null } | null>(null)
const width = computed(() => live.value?.width ?? cfg.value.width)
const height = computed(() => (cfg.value.collapsed ? null : live.value ? live.value.height : cfg.value.height))
const card = ref<HTMLElement | null>(null)
/** Drag the corner: the width, and the height once it moves up or down (not while minimized). */
const onGrip = cornerResize({
  start: () => {
    const box = card.value?.getBoundingClientRect()
    return { width: box?.width ?? cfg.value.width, height: box?.height ?? 0 }
  },
  move: (size, vertical) => {
    const sized = !cfg.value.collapsed && (vertical || cfg.value.height !== null)
    live.value = { width: clampTo(size.width, METER_WIDTH), height: sized ? clampTo(size.height, METER_HEIGHT) : null }
  },
  end: () => {
    if (live.value) set(cfg.value.collapsed ? { width: live.value.width } : live.value)
    live.value = null
  },
})
const resetSize = (): void => set({ width: 340, height: null })

// Hide while idle: the time the numbers last moved (a hit, a heal, a reset).
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)
const lastActive = ref(0)
watch([total, () => meter.value.target?.id], () => (lastActive.value = Date.now()))
const idle = computed(() => cfg.value.hideIdle && !live.value && now.value - lastActive.value >= cfg.value.idleSeconds * 1000)
const moreModes = computed(() => !MAIN_TARGET_MODES.some((m) => m.id === cfg.value.targetMode))

/** Tell main how big the window is. */
let sent = ''
function report(): void {
  const r = root.value?.getBoundingClientRect() ?? { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('meter:resize', { width: r.width, height: r.height })
}
watch([rows, () => meter.value.target, status, () => store.ready, () => cfg.value.collapsed, idle, width, height], () => void nextTick(report), { deep: true })

let observer: ResizeObserver | null = null
const offs: (() => void)[] = []
onMounted(async () => {
  offs.push(api.on('meter:dps', (m) => (meter.value = m)))
  meter.value = await api.invoke('meter:get')
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => {
  clearInterval(ticker)
  observer?.disconnect()
  for (const off of offs) off()
})
</script>

<template>
  <div class="inline-block">
    <!-- Idle, nothing is drawn: main hides a window that measures 0 × 0. -->
    <div ref="root" class="inline-block">
      <div
        v-if="!idle"
        ref="card"
        class="group relative m-1.5 flex flex-col rounded-xl border border-card bg-darker/95 shadow-card"
        :style="{ opacity: cfg.opacity, width: `${width}px`, height: height === null ? undefined : `${height}px` }"
      >
        <header :class="['cursor-move px-3', cfg.collapsed ? 'py-1.5' : 'pb-1.5 pt-2.5']" :title="t('Drag to move')" @pointerdown="drag.onPointerDown">
          <div class="flex items-center gap-2">
            <span :class="['size-1.5 shrink-0 rounded-full', statusDot]" :title="status.detail ?? t(STATUS_TEXT[status.state])" />
            <span class="min-w-0 flex-1 truncate text-[13px] font-semibold text-default">
              {{ t(STAT_TITLE[cfg.stat][0]) }}<span v-if="meter.battleTime" class="font-normal text-darker"> ({{ clock(meter.battleTime) }})</span>
            </span>
            <span v-if="cfg.collapsed && all.length" class="shrink-0 text-[13px] font-bold tabular-nums text-accent">
              {{ short(totalPerSecond) }}<span class="ml-0.5 text-[10px] font-medium text-darker">{{ STAT_TITLE[cfg.stat][2] }}</span>
            </span>
            <span v-else-if="!cfg.collapsed" class="max-w-[45%] truncate text-[11px] text-darker" :title="meter.target?.name">{{ meter.target?.name }}</span>
            <button
              type="button"
              :class="['flex size-5 shrink-0 items-center justify-center rounded hover:bg-dark', skillsOn ? 'text-accent' : 'text-darker hover:text-default']"
              :title="skillsOn ? t('My skills overlay on: click to hide it') : t('My skills overlay off: click to show it')"
              @pointerdown.stop
              @click="toggleSkills"
            >
              <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z" />
              </svg>
            </button>
            <button
              type="button"
              class="flex size-5 shrink-0 items-center justify-center rounded text-darker hover:bg-dark hover:text-default"
              :title="t('Reset the meter')"
              @pointerdown.stop
              @click="reset"
            >
              <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6">
                <path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v3h-3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <CollapseButton :collapsed="cfg.collapsed" @toggle="set({ collapsed: !cfg.collapsed })" />
          </div>
          <div v-if="all.length && !cfg.collapsed" class="mt-0.5 flex items-baseline justify-between">
            <span class="text-[12px] text-darker">{{ t(STAT_TITLE[cfg.stat][1]) }} <span class="font-medium text-dark">{{ short(total) }}</span></span>
            <span class="text-xl font-bold tabular-nums text-accent">{{ short(totalPerSecond) }}<span class="ml-0.5 text-[11px] font-medium text-darker">{{ STAT_TITLE[cfg.stat][2] }}</span></span>
          </div>
        </header>

        <div v-if="!cfg.collapsed" class="flex min-h-0 flex-1 flex-col">
        <!-- The switches, while the pointer is over the meter. -->
        <div class="hidden flex-wrap gap-1 px-3 pb-1.5 text-[10px] group-hover:flex" @pointerdown.stop>
          <div class="flex rounded-md bg-dark p-0.5">
            <button
              v-for="m in MAIN_TARGET_MODES"
              :key="m.id"
              type="button"
              :class="['rounded px-1.5 py-0.5', cfg.targetMode === m.id ? 'bg-light text-default' : 'text-darker hover:text-default']"
              @click="set({ targetMode: m.id })"
            >{{ t(m.label) }}</button>
            <select
              :class="['rounded bg-transparent px-1 py-0.5', moreModes ? 'bg-light text-default' : 'text-darker']"
              :title="t('More ways to pick the target')"
              :value="moreModes ? cfg.targetMode : ''"
              @change="set({ targetMode: ($event.target as HTMLSelectElement).value as TargetMode })"
            >
              <option value="" disabled>{{ t('More') }}</option>
              <option v-for="m in ['mostDamage', 'mostRecent', 'trainTargets'] as const" :key="m" :value="m">{{ t(TARGET_MODE_LABELS[m]) }}</option>
            </select>
          </div>
          <div class="flex rounded-md bg-dark p-0.5">
            <button
              v-for="p in METER_PLAYERS"
              :key="p.id"
              type="button"
              :class="['rounded px-1.5 py-0.5', cfg.players === p.id ? 'bg-light text-default' : 'text-darker hover:text-default']"
              @click="set({ players: p.id as MeterPlayers })"
            >{{ t(p.label) }}</button>
          </div>
          <div class="flex rounded-md bg-dark p-0.5">
            <button
              v-for="s in METER_STATS"
              :key="s.id"
              type="button"
              :class="['rounded px-1.5 py-0.5', cfg.stat === s.id ? 'bg-light text-default' : 'text-darker hover:text-default']"
              @click="set({ stat: s.id as MeterStat })"
            >{{ t(s.label) }}</button>
          </div>
        </div>

        <div v-if="hpShare !== null" class="px-3 pb-1.5">
          <div class="relative h-3.5 overflow-hidden rounded bg-dark">
            <div class="h-full bg-danger/70" :style="{ width: `${hpShare * 100}%` }" />
            <span class="absolute inset-0 flex items-center justify-center gap-1.5 text-[9px] font-semibold tabular-nums text-default">
              {{ (hpShare * 100).toFixed(1) }}% · {{ short(meter.target!.hp!) }}<template v-if="ttk !== null"> · {{ t('dies in {time}', { time: clock(ttk) }) }}</template>
            </span>
          </div>
        </div>

        <template v-if="rows.length">
          <div class="flex items-center gap-1.5 px-3 pb-1 text-[10px] text-darkest">
            <span class="min-w-0 flex-1 pl-6">{{ t('Player') }}</span>
            <span class="w-12 text-right">{{ STAT_TITLE[cfg.stat][2] }}</span>
            <span class="w-10 text-right">{{ t('Share') }}</span>
            <span class="w-12 text-right">{{ cfg.stat === 'taken' ? t('Taken') : cfg.stat === 'healing' ? t('Healed') : t('Damage') }}</span>
            <span v-if="cfg.stat === 'damage'" class="w-8 text-right">Crit</span>
          </div>
          <ul :class="['space-y-0.5 px-1.5 pb-1.5', height !== null && 'min-h-0 flex-1 overflow-y-auto']">
            <li
              v-for="r in rows"
              :key="r.id"
              :class="['relative cursor-pointer overflow-hidden rounded-md bg-dark', r.you ? 'ring-1 ring-accent' : 'hover:ring-1 hover:ring-light']"
              :title="t('{class} · click for the details', { class: r.className ?? t('Unknown class') })"
              @click="showDetails(r.id)"
            >
              <div class="absolute inset-y-0 left-0 opacity-50" :style="{ width: `${(r.value / top) * 100}%`, background: CLASS_COLORS[r.className ?? ''] ?? '#787b8a' }" />
              <div class="relative flex items-center gap-1.5 px-1.5 py-1 text-[12px]">
                <img v-if="icon(r.className)" :src="icon(r.className)!" class="size-4 shrink-0" alt="" />
                <span v-else class="size-4 shrink-0" />
                <span :class="['min-w-0 flex-1 truncate font-medium', r.you ? 'text-accent' : 'text-default']">{{ r.name }}</span>
                <span class="w-12 text-right font-semibold tabular-nums text-default">{{ short(r.perSecond) }}</span>
                <span class="w-10 text-right tabular-nums text-dark">{{ r.part.toFixed(1) }}%</span>
                <span class="w-12 text-right tabular-nums text-dark">{{ short(r.value) }}</span>
                <span v-if="cfg.stat === 'damage'" :class="['w-8 text-right tabular-nums', r.you ? 'text-green' : 'text-dark']">{{ Math.round(r.critRate * 100) }}%</span>
              </div>
            </li>
          </ul>
        </template>
        <p v-else class="px-3 pb-2.5 text-[11px] text-darker">{{ empty }}</p>

        <div v-if="height !== null && !rows.length" class="flex-1" />
        <footer v-if="meter.ping !== null || all.length > rows.length" class="mt-auto flex gap-2 border-t border-card px-3 py-1 text-[10px] tabular-nums text-darkest">
          <span>{{ t(TARGET_MODE_LABELS[meter.mode]) }}</span>
          <span v-if="all.length > rows.length">{{ t('+{n} more', { n: all.length - rows.length }) }}</span>
          <span v-if="meter.ping !== null" class="ml-auto" :title="t('Your ping to the game server')">
            <span :class="pingClass">{{ meter.ping }}</span> ms
          </span>
        </footer>
        </div>
        <!-- The corner: drag to resize, double-click for the default size. -->
        <ResizeGrip :active="!!live" @grab="onGrip" @reset="resetSize" />
      </div>
    </div>
  </div>
</template>
