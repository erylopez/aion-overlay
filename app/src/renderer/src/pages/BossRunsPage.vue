<script setup lang="ts">
// Boss Runs: Verteron's field bosses about to spawn (shared/bossRuns.ts), soonest first, each with
// its Kibelisk as chat calls it ("Dartan · TP 33") and its countdown. It comes up by itself when
// more than 2 spawn close one after another (or as many alive at once as set), and stays while any is left: a boss seen killed (in
// view, or listed dead again by the map) is struck out a moment, then fades and the list moves up.
// Moved by its header; its corner makes it bigger or smaller, text and all; minimized it is its
// header with the next boss; its X hides it until the next run. Low priority bosses are in grey. While the dashboard is up with no
// run on, it shows a sample to place it by. Nothing to show measures 0, and main keeps it hidden.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CloseButton from '@/components/CloseButton.vue'
import CollapseButton from '@/components/CollapseButton.vue'
import ResizeGrip from '@/components/ResizeGrip.vue'
import { bridge } from '@/lib/bridge.ts'
import { cornerResize } from '@/lib/cornerResize.ts'
import { t } from '@/lib/i18n.ts'
import { panelStyle } from '@/lib/overlayLook.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { aliveCount, BOSS_RUNS, clustered, runRows, type RunRow } from '@shared/bossRuns.ts'
import { BOSSRUNS_SCALE, SETTINGS_DEFAULTS, type Settings } from '@shared/settings.ts'
import { bossPortrait } from '@shared/timers.ts'

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.bossRuns)

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)

const rows = computed(() => runRows(store.fieldBosses, now.value, cfg.value.windowMinutes * 60_000))

/** A run worth showing: a cluster coming, or as many alive as set. */
const isRun = (list: RunRow[]): boolean => clustered(list) || (cfg.value.aliveMin > 0 && aliveCount(list, cfg.value.ignoreLow ? cfg.value.lowPriority : []) >= cfg.value.aliveMin)
/** Up once a run is on, until nothing is left on the list. */
const active = ref(false)
/** The bosses on the list when its X was pressed: a run of others brings it back. */
const dismissed = ref(new Set<number>())
watch(
  [rows, () => cfg.value.aliveMin, () => cfg.value.ignoreLow, () => cfg.value.lowPriority],
  ([list]) => {
    if (isRun(list.filter((r) => !dismissed.value.has(r.run.boss)))) {
      active.value = true
      dismissed.value = new Set()
    } else if (!list.length) {
      active.value = false
      dismissed.value = new Set()
    }
  },
  { immediate: true },
)
function dismiss(): void {
  dismissed.value = new Set(rows.value.map((r) => r.run.boss))
  active.value = false
}

const SAMPLE = computed<RunRow[]>(() => {
  const at = now.value
  const pick = (boss: number) => BOSS_RUNS.find((r) => r.boss === boss)!
  return [
    { run: pick(101001), at: at - 5_000, status: 'killed' },
    { run: pick(101022), at: at - 60_000, status: 'up' },
    { run: pick(101018), at: at + 3 * 60_000 + 20_000, status: 'soon' },
    { run: pick(101017), at: at + 8 * 60_000 + 5_000, status: 'soon' },
  ]
})
/** Nothing coming while the dashboard is up: a sample to place it by. */
const preview = computed(() => !active.value && store.panelVisible)
const isLow = (boss: number): boolean => cfg.value.lowPriority.includes(boss)
const list = computed(() => fit(active.value ? rows.value : preview.value ? SAMPLE.value : []))
/**
 * Up to the setting's count of bosses of normal priority: the low priority ones (and the ones just
 * killed) in between don't take their place, so the list grows by them; never shorter than the count.
 */
function fit(all: RunRow[]): RunRow[] {
  let normal = 0
  return all.filter((r, i) => {
    if (normal >= cfg.value.rows && i >= cfg.value.rows) return false
    if (r.status !== 'killed' && !isLow(r.run.boss)) normal++
    return true
  })
}
/** Minimized: the first not yet killed, shown in the header. */
const next = computed(() => list.value.find((r) => r.status !== 'killed') ?? null)

const set = (patch: Partial<Settings['bossRuns']>): void => void store.set('bossRuns', { ...cfg.value, ...patch })
/** Its size while the corner is dragged; the saved one otherwise. */
const live = ref<number | null>(null)
const scale = computed(() => live.value ?? cfg.value.scale)
const BASE_WIDTH = 260
const onGrip = cornerResize({
  start: () => ({ width: BASE_WIDTH * scale.value, height: 0 }),
  move: (size) => (live.value = Math.min(BOSSRUNS_SCALE[1], Math.max(BOSSRUNS_SCALE[0], size.width / BASE_WIDTH))),
  end: () => {
    if (live.value !== null) set({ scale: Math.round(live.value * 100) / 100 })
    live.value = null
  },
})

/** 4:09; "up" once it has spawned. */
function countdown(at: number): string {
  const s = Math.ceil((at - now.value) / 1000)
  if (s <= 0) return t('up')
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

const drag = windowDrag({ move: 'bossruns:moveTo', end: 'bossruns:dragEnd' })

let sent = ''
function report(): void {
  const el = root.value
  const r = el && list.value.length ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('bossruns:resize', { width: r.width, height: r.height })
}
watch([() => list.value.length, scale, () => cfg.value.collapsed], () => void nextTick(report))

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => {
  clearInterval(ticker)
  observer?.disconnect()
})
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <section
        v-if="list.length"
        class="text-glow group relative m-1.5 cursor-move rounded-xl border px-3 py-2"
        :style="{ ...panelStyle(cfg.opacity), zoom: scale, width: `${BASE_WIDTH}px` }"
        @pointerdown="drag.onPointerDown($event)"
      >
        <div class="flex items-center gap-2 text-[13px]">
          <span class="size-1.5 shrink-0 rounded-full bg-accent" />
          <span class="shrink-0 font-semibold text-default">{{ t('Boss Runs') }}</span>
          <template v-if="cfg.collapsed && next">
            <span :class="['min-w-0 truncate text-[12px]', isLow(next.run.boss) ? 'text-darker' : 'text-dark']">{{ next.run.short }}</span>
            <span
              v-if="next.run.tp !== null"
              :class="['shrink-0 rounded px-1 text-[11px] font-semibold tabular-nums leading-4', isLow(next.run.boss) ? 'bg-white/10 text-darker' : 'bg-yellow/15 text-yellow']"
            >TP {{ next.run.tp }}</span>
            <span :class="['shrink-0 text-xs font-semibold tabular-nums', isLow(next.run.boss) ? 'text-darker' : next.status === 'up' ? 'text-green' : 'text-default']">{{ countdown(next.at) }}</span>
          </template>
          <span v-else-if="preview" class="truncate text-[11px] text-darker">{{ t('drag to move') }}</span>
          <span class="flex-1" />
          <CollapseButton :collapsed="cfg.collapsed" class="-my-1" @toggle="set({ collapsed: !cfg.collapsed })" />
          <button
            v-if="!preview"
            type="button"
            class="-my-1 -mr-1 flex size-5 shrink-0 items-center justify-center rounded text-darker hover:bg-dark hover:text-default"
            :title="t('Hide until the next run (turn it off in the app)')"
            @pointerdown.stop
            @dblclick.stop
            @click="dismiss"
          >
            <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
          <CloseButton v-else class="-my-1 -mr-1" @close="set({ enabled: false })" />
        </div>
        <TransitionGroup v-if="!cfg.collapsed" tag="div" name="run" class="relative mt-1">
          <div
            v-for="r in list"
            :key="r.run.boss"
            :class="['flex w-full items-center gap-2 py-0.5 text-[13px] transition-opacity duration-500', r.status === 'killed' && 'opacity-50']"
          >
            <img v-if="bossPortrait(r.run.boss)" :src="bossPortrait(r.run.boss)!" alt="" draggable="false" :class="['size-5 shrink-0 rounded-sm object-cover', isLow(r.run.boss) && 'opacity-60 grayscale']" />
            <span :class="['shrink-0 font-medium', isLow(r.run.boss) ? 'text-darker' : 'text-default', r.status === 'killed' && 'line-through decoration-red decoration-2']">{{ r.run.short }}</span>
            <span
              v-if="r.run.tp !== null"
              :class="['shrink-0 rounded px-1 text-[11px] font-semibold tabular-nums leading-4', isLow(r.run.boss) ? 'bg-white/10 text-darker' : 'bg-yellow/15 text-yellow']"
            >TP {{ r.run.tp }}</span>
            <span v-else-if="r.run.tpName" class="min-w-0 truncate text-[11px] text-darker">{{ r.run.tpName }}</span>
            <span v-if="r.status === 'killed'" class="ml-auto shrink-0 text-[11px] font-semibold uppercase text-red">{{ t('killed') }}</span>
            <span
              v-else
              :class="['ml-auto shrink-0 text-xs font-semibold tabular-nums', isLow(r.run.boss) ? 'text-darker' : r.status === 'up' ? 'text-green' : r.at - now < 60_000 ? 'text-yellow' : 'text-default']"
            >{{ countdown(r.at) }}</span>
          </div>
        </TransitionGroup>
        <ResizeGrip :active="live !== null" @grab="onGrip" @reset="set({ scale: SETTINGS_DEFAULTS.bossRuns.scale })" />
      </section>
    </div>
  </div>
</template>

<style scoped>
/* A killed boss fades out (taken out of the flow so the others move up as it goes); a new one fades in. */
.run-move {
  transition: transform 0.5s ease;
}
.run-enter-active,
.run-leave-active {
  transition: opacity 0.8s ease;
}
.run-leave-active {
  position: absolute;
}
.run-enter-from,
.run-leave-to {
  opacity: 0;
}
</style>
