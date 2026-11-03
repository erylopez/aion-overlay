<script setup lang="ts">
// The timers as a bar over the game: each timer with its alert on (the Event Alerts and Field Bosses pages) that starts
// within the next 13 hours, soonest first, as its icon and a countdown. Events have their own icon
// (the rift's stands for the invasion and the siege too), field bosses their portrait, the rest a
// short name. Moved by dragging; sized to what it shows, and hidden with nothing to show. Hovering
// one names it right away, in a label under the bar (the window grows to it: a title's tooltip
// waits a second or so).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { loc, t } from '@/lib/i18n.ts'
import { windowDrag } from '@/lib/windowDrag.ts'
import { useApp } from '@/stores/app.ts'
import { bossPortrait, nextStart, TIMERS, type TimerDef, type TimerId } from '@shared/timers.ts'

/** Starts further away than this are left off the bar. */
const HORIZON_MS = 13 * 3600_000

const store = useApp()
const root = ref<HTMLElement | null>(null)
const cfg = computed(() => store.settings.timers)

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)

const ICONS: Partial<Record<TimerId, string>> = {
  shugo: 'events/shugo.webp',
  rift: 'events/rift.webp',
  invasion: 'events/rift.webp',
  siege: 'events/rift.webp',
  siegeBosses: 'events/rift.webp',
}
const LABELS: Partial<Record<TimerId, string>> = {
  kaira: 'Kaira',
  nahma: 'Nahma',
  merchant: 'Merchant',
  dailyReset: 'Daily',
  weeklyReset: 'Weekly',
}
const icon = (def: TimerDef): string | null =>
  def.schedule.kind === 'boss' ? bossPortrait(def.schedule.boss) : (ICONS[def.id] ?? null)

const alerting = computed(() => new Map(store.alerting.map((a) => [a.id, a.at])))

/** The timers to show: alert on, starting within the horizon (or alerting now), soonest first. */
const items = computed(() =>
  TIMERS.filter((def) => cfg.value.enabled[def.id] && cfg.value.shown[def.id])
    .map((def) => ({
      def,
      at: alerting.value.get(def.id) ?? nextStart(def.schedule, now.value, cfg.value.region, store.fieldBosses),
    }))
    .filter(({ at }) => Number.isFinite(at) && at - now.value <= HORIZON_MS)
    .sort((a, b) => a.at - b.at),
)

/** 48:09, 1:48:09; "now" once it has started. */
function countdown(at: number): string {
  const s = Math.ceil((at - now.value) / 1000)
  if (s <= 0) return 'now'
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** The timer hovered, and where its label goes: under it (its offset from the page's left). */
const hovered = ref<{ id: TimerId; x: number } | null>(null)
const hoveredItem = computed(() => (hovered.value ? items.value.find((i) => i.def.id === hovered.value!.id) : undefined))
function hover(id: TimerId, e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement
  hovered.value = { id, x: el.offsetLeft }
}
const startsAt = (at: number): string => new Date(at).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })

const drag = windowDrag({ move: 'timerbar:moveTo', end: 'timerbar:dragEnd' })

/** Tell main how big the window is; nothing to show measures 0, and main keeps it hidden. */
let sent = ''
function report(): void {
  const el = root.value
  const r = el && items.value.length ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void bridge().invoke('timerbar:resize', { width: r.width, height: r.height })
}
watch([() => items.value.length, () => store.ready], () => void nextTick(report))

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
  <!-- w-max: laid out at its own width, not the window's, so it measures what it needs and the
       window grows to it (inside a narrower window the items shrank and their numbers were cut). -->
  <div class="inline-block w-max">
    <div ref="root" class="inline-block w-max">
      <!-- Sized like the kill feed's title bar: 12 px figures, 16 px icons. -->
      <div
        v-if="items.length"
        class="m-1.5 flex w-max cursor-move items-center gap-3 whitespace-nowrap rounded-lg border border-card bg-darker px-2.5 py-1.5 shadow-card"
        :style="{ opacity: store.settings.timerBar.opacity }"
        :title="t('Drag to move')"
        @pointerdown="(e) => ((hovered = null), drag.onPointerDown(e))"
      >
        <div
          v-for="{ def, at } in items"
          :key="def.id"
          class="flex shrink-0 items-center gap-1.5"
          title=""
          @pointerenter="hover(def.id, $event)"
          @pointerleave="hovered = null"
        >
          <img v-if="icon(def)" :src="icon(def)!" class="size-4 shrink-0 rounded-sm object-cover" alt="" draggable="false" />
          <span v-else class="text-[11px] font-semibold uppercase tracking-wide text-darker">{{ t(LABELS[def.id] ?? def.name) }}</span>
          <span v-if="alerting.has(def.id)" class="size-1.5 shrink-0 rounded-full bg-yellow" />
          <!-- As wide as its widest form, so the bar doesn't twitch as the seconds go by. -->
          <span
            :class="['text-xs font-semibold tabular-nums', alerting.has(def.id) ? 'text-yellow' : 'text-default']"
            :style="{ minWidth: `${countdown(at).length}ch` }"
          >{{ countdown(at) }}</span>
        </div>
      </div>
      <!-- In the flow, not floating: the window is measured with it, so it isn't cut off. -->
      <div
        v-if="hoveredItem"
        class="mx-1.5 mb-1.5 w-max whitespace-nowrap rounded-md border border-card bg-darker px-2 py-1 text-xs shadow-card"
        :style="{ marginLeft: `${hovered!.x}px`, opacity: store.settings.timerBar.opacity }"
      >
        <span class="font-semibold text-default">{{ t(hoveredItem.def.name) }}</span>
        <span class="ml-1.5 tabular-nums text-darker">{{ startsAt(hoveredItem.at) }}</span>
      </div>
    </div>
  </div>
</template>
