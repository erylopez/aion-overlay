<script setup lang="ts">
// Boss Runs: Verteron's field bosses about to spawn (shared/bossRuns.ts), soonest first, each with
// its Kibelisk as chat calls it ("Dartan · TP 33") and its countdown. It comes up by itself when
// more than 2 spawn close one after another, and stays while any is left: a boss seen killed (in
// view, or listed dead again by the map) is struck out a moment, then fades and the list moves up.
// Clicks go through to the game; while the dashboard is up it shows a sample, and can be dragged
// into place. Nothing to show measures 0, and main keeps the window hidden.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { t } from '@/lib/i18n.ts'
import { panelStyle } from '@/lib/overlayLook.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { BOSS_RUNS, clustered, runRows, type RunRow } from '@shared/bossRuns.ts'
import { bossPortrait } from '@shared/timers.ts'

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.bossRuns)

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)

const rows = computed(() => runRows(store.fieldBosses, now.value, cfg.value.windowMinutes * 60_000))

/** Up once a cluster is coming, until nothing is left on the list. */
const active = ref(false)
watch(
  rows,
  (list) => {
    if (clustered(list)) active.value = true
    else if (!list.length) active.value = false
  },
  { immediate: true },
)

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
const list = computed(() => (active.value ? rows.value : preview.value ? SAMPLE.value : []).slice(0, cfg.value.rows))

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
watch(() => list.value.length, () => void nextTick(report))

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
        :class="['text-glow m-1.5 w-[260px] rounded-lg border px-2.5 py-2', store.panelVisible && 'cursor-move']"
        :style="panelStyle(cfg.opacity, '234 179 8')"
        @pointerdown="store.panelVisible && drag.onPointerDown($event)"
      >
        <div class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-yellow">
          <span class="size-1.5 rounded-full bg-yellow" />
          {{ t('Boss Runs') }}
          <span v-if="preview" class="ml-auto font-normal normal-case tracking-normal text-darker">{{ t('drag to move') }}</span>
        </div>
        <TransitionGroup tag="div" name="run" class="relative">
          <div
            v-for="r in list"
            :key="r.run.boss"
            :class="['flex w-full items-center gap-2 py-0.5 text-[13px] transition-opacity duration-500', r.status === 'killed' && 'opacity-50']"
          >
            <img v-if="bossPortrait(r.run.boss)" :src="bossPortrait(r.run.boss)!" alt="" draggable="false" class="size-5 shrink-0 rounded-sm object-cover" />
            <span :class="['shrink-0 font-medium text-default', r.status === 'killed' && 'line-through decoration-red decoration-2']">{{ r.run.short }}</span>
            <span v-if="r.run.tp !== null" class="shrink-0 rounded bg-yellow/15 px-1 text-[11px] font-semibold tabular-nums leading-4 text-yellow">TP {{ r.run.tp }}</span>
            <span v-else-if="r.run.tpName" class="min-w-0 truncate text-[11px] text-darker">{{ r.run.tpName }}</span>
            <span v-if="r.status === 'killed'" class="ml-auto shrink-0 text-[11px] font-semibold uppercase text-red">{{ t('killed') }}</span>
            <span
              v-else
              :class="['ml-auto shrink-0 text-xs font-semibold tabular-nums', r.status === 'up' ? 'text-green' : r.at - now < 60_000 ? 'text-yellow' : 'text-default']"
            >{{ countdown(r.at) }}</span>
          </div>
        </TransitionGroup>
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
