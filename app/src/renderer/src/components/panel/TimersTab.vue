<script setup lang="ts">
// The game's periodic events and the field bosses: each one's next start in your local time and
// how long until it, with a switch for its alert (and, when on, how early). Only the timers chosen
// in "Choose timers" are listed, and only those alert: the events and Gartua at first. Alerts chime
// and shake the bubble (the settings below); a click on the bubble dismisses them and shows them
// here. Times not yet checked against the game are marked unconfirmed.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Button from '@/components/Button.vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import { playChime } from '@/lib/chime.ts'
import { useApp } from '@/stores/app.ts'
import { leadChoices, nextStart, REGIONS, TIMERS, type Region, type TimerDef, type TimerId } from '@shared/timers.ts'

const store = useApp()
const cfg = computed(() => store.settings.timers)

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 15_000)
onBeforeUnmount(() => clearInterval(ticker))

const time = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const day = (ms: number): string => new Date(ms).toLocaleDateString([], { weekday: 'short' })
const isBoss = (def: TimerDef): boolean => def.schedule.kind === 'boss'
/** A field boss's portrait (public/bosses, from scripts/fetch-boss-icons.mjs). */
const portrait = (def: TimerDef): string | null => (def.schedule.kind === 'boss' ? `bosses/${def.schedule.boss}.webp` : null)

/** When it happens, in your local time: the row's second line. */
function when(def: TimerDef): string {
  const s = def.schedule
  if (s.kind === 'boss') {
    const b = store.fieldBosses[s.boss]
    if (!b) return 'Open the map to update'
    const via = b.source === 'shared' ? ' · shared' : ''
    if (b.up) return `Up since ${time(b.at)}${via}`
    return b.at < now.value ? `Due since ${time(b.at)}${via}` : `Respawns ${day(b.at)} ${time(b.at)}${via}`
  }
  if (s.kind === 'every') {
    if (s.every === 60) return `Every hour at :${String(s.offset).padStart(2, '0')}`
    return `Every ${s.every / 60} hours`
  }
  // The next week of starts, in local days and times.
  const starts: number[] = []
  let from = now.value
  for (let i = 0; i < s.days.length * s.times.length; i++) {
    const n = nextStart(s, from, cfg.value.region)
    if (!Number.isFinite(n)) break
    starts.push(n)
    from = n + 1
  }
  if (s.days.length === 7 && s.times.length > 1) {
    const gap = (s.times[1]! - s.times[0]!) / 60
    return `Every ${gap} hours`
  }
  const times = [...new Set(starts.map(time))]
  if (s.days.length === 7) return `Daily at ${times.join(', ')}`
  const days = [...new Set([...starts].sort((x, y) => new Date(x).getDay() - new Date(y).getDay()).map(day))]
  return `${days.join(', ')} at ${times.join(', ')}`
}

function countdown(ms: number): string {
  const min = Math.max(0, Math.ceil((ms - now.value) / 60_000))
  if (min === 0) return 'now'
  if (min < 60) return `in ${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `in ${h} h ${min % 60} min` : `in ${Math.floor(h / 24)} d ${h % 24} h`
}

const alerting = computed(() => new Set(store.alerting.map((a) => a.id)))
const shown = (id: TimerId): boolean => cfg.value.shown[id] ?? false
/**
 * The timers chosen to be shown, soonest first. A timer alerting just after its start keeps that
 * start ("now") rather than the next one, so it stays at the top while its alert is up.
 */
const rows = computed(() =>
  TIMERS.filter((def) => shown(def.id) || alerting.value.has(def.id))
    .map((def) => {
      const next =
        store.alerting.find((a) => a.id === def.id)?.at ?? nextStart(def.schedule, now.value, cfg.value.region, store.fieldBosses)
      const boss = bossNote(def)
      if (boss) return { def, next: boss.sort, at: boss.at, left: boss.left }
      const sameDay = new Date(next).toDateString() === new Date(now.value).toDateString()
      return { def, next, at: sameDay ? time(next) : `${day(next)} ${time(next)}`, left: countdown(next) }
    })
    .sort((a, b) => a.next - b.next),
)

/**
 * A field boss with no start to count down to: up now (top of the list), its respawn passed without
 * the map saying more, or never seen (bottom). Null when it has a respawn ahead.
 */
function bossNote(def: TimerDef): { sort: number; at: string; left: string } | null {
  const s = def.schedule
  if (s.kind !== 'boss') return null
  const b = store.fieldBosses[s.boss]
  if (!b) return { sort: Number.POSITIVE_INFINITY, at: '—', left: 'not seen' }
  if (b.up) return { sort: now.value, at: 'Up', left: `since ${time(b.at)}` }
  if (b.at < now.value - 2 * 60_000) return { sort: now.value, at: 'Due', left: `since ${time(b.at)}` }
  return null
}

/** The game's events, then the field bosses, each only if any of it is shown. */
const groups = computed(() =>
  [
    { title: 'Events', rows: rows.value.filter((r) => !isBoss(r.def)) },
    { title: 'Field bosses · Verteron', rows: rows.value.filter((r) => isBoss(r.def)) },
  ].filter((g) => g.rows.length),
)

/** The "Choose timers" list is open. */
const choosing = ref(false)

/** The timers the bubble was clicked for: scrolled to, and highlighted for a moment. */
const FLASH_MS = 2500
const flashing = ref(new Set<TimerId>())
let flashTimer: ReturnType<typeof setTimeout> | null = null
const list = ref<HTMLElement | null>(null)
watch(
  () => store.timerFocus,
  async (focus) => {
    if (!focus || Date.now() - focus.at > FLASH_MS) return
    choosing.value = false
    flashing.value = new Set(focus.ids)
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => (flashing.value = new Set()), FLASH_MS)
    await nextTick()
    const first = rows.value.find((r) => focus.ids.includes(r.def.id))
    list.value?.querySelector(`[data-timer="${first?.def.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  },
  { immediate: true },
)
onBeforeUnmount(() => flashTimer && clearTimeout(flashTimer))

function set(patch: Partial<typeof cfg.value>): void {
  void store.set('timers', { ...cfg.value, ...patch })
}
function toggle(id: TimerId, on: boolean): void {
  set({ enabled: { ...cfg.value.enabled, [id]: on } })
}
function setLead(id: TimerId, minutes: number): void {
  set({ lead: { ...cfg.value.lead, [id]: minutes } })
}
/** "at start", "5 min", "1 h": how early an alert comes. */
const leadLabel = (m: number): string => (m === 0 ? 'at start' : m < 60 ? `${m} min` : `${m / 60} h`)
const pct = (v: number): string => `${Math.round(v * 100)}%`

// ---- Choose timers: which are listed (and so can alert) ---------------------------------------
const pickGroups = computed(() => [
  { title: 'Events', defs: TIMERS.filter((d) => !isBoss(d)) },
  { title: 'Field bosses · Verteron', defs: TIMERS.filter(isBoss).sort((a, b) => a.name.localeCompare(b.name)) },
])
function show(ids: TimerId[], on: boolean): void {
  set({ shown: { ...cfg.value.shown, ...Object.fromEntries(ids.map((id) => [id, on])) } })
}
const shownCount = computed(() => TIMERS.filter((d) => shown(d.id)).length)
</script>

<template>
  <div class="space-y-4 p-3">
    <div ref="list" class="space-y-3">
      <p v-if="!groups.length" class="rounded-lg border border-card bg-card px-3 py-4 text-center text-sm text-darker">
        No timers shown. Choose some below.
      </p>
      <section v-for="g in groups" :key="g.title">
        <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-darkest">{{ g.title }}</h3>
        <TransitionGroup tag="ul" name="reorder" class="divide-y divide-[color:var(--gray-4)] overflow-hidden rounded-lg border border-card bg-card">
          <li
            v-for="r in g.rows"
            :key="r.def.id"
            :data-timer="r.def.id"
            :title="`${r.def.name}: ${when(r.def)} · ${r.def.detail}`"
            :class="[
              'flex items-center gap-2.5 px-2.5 py-1.5 transition-[background-color,box-shadow] duration-700',
              flashing.has(r.def.id) ? 'bg-yellow/25 ring-2 ring-inset ring-yellow/70' : alerting.has(r.def.id) && 'bg-yellow/10',
            ]"
          >
            <img
              v-if="portrait(r.def)"
              :src="portrait(r.def)!"
              alt=""
              draggable="false"
              loading="lazy"
              class="size-8 shrink-0 rounded-md border border-light object-cover"
            />
            <div v-else class="flex size-8 shrink-0 items-center justify-center rounded-md border border-light bg-default text-darker">
              <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 4.5V8l2.5 1.5" stroke-linecap="round" />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span v-if="alerting.has(r.def.id)" class="size-1.5 shrink-0 animate-pulse rounded-full bg-yellow" />
                <span class="truncate text-sm font-medium">{{ r.def.name }}</span>
              </div>
              <div class="truncate text-[11px] text-darker">
                <span v-if="!r.def.confirmed" class="text-yellow">unconfirmed · </span>{{ when(r.def) }}
              </div>
            </div>
            <div class="shrink-0 whitespace-nowrap text-right">
              <div :class="['text-sm tabular-nums', r.at === 'Up' && 'text-green']">{{ r.at }}</div>
              <div :class="['text-[11px] tabular-nums', alerting.has(r.def.id) ? 'text-yellow' : 'text-darker']">{{ r.left }}</div>
            </div>
            <!-- The alert: on or off, and (when on) how early. -->
            <div class="flex w-[68px] shrink-0 flex-col items-end gap-1">
              <Toggle
                :model-value="cfg.enabled[r.def.id] ?? false"
                :title="cfg.enabled[r.def.id] ? 'Alert on' : 'Alert off'"
                @update:model-value="toggle(r.def.id, $event)"
              />
              <select
                v-if="cfg.enabled[r.def.id]"
                :value="cfg.lead[r.def.id]"
                class="h-6 w-full rounded-md border border-light bg-default px-1 text-[11px]"
                title="How early to alert"
                @change="setLead(r.def.id, Number(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="m in leadChoices(r.def)" :key="m" :value="m">{{ leadLabel(m) }}</option>
              </select>
            </div>
          </li>
        </TransitionGroup>
      </section>
    </div>

    <!-- Choose timers: which are listed above (and so can alert). -->
    <section>
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-lg border border-card bg-card px-3 py-2 text-sm hover:bg-dark"
        @click="choosing = !choosing"
      >
        <span>Choose timers <span class="text-darker">· {{ shownCount }} of {{ TIMERS.length }} shown</span></span>
        <span class="text-darker">{{ choosing ? 'Done' : 'Edit' }}</span>
      </button>
      <div v-if="choosing" class="mt-2 space-y-3 rounded-lg border border-card bg-card p-3">
        <div v-for="g in pickGroups" :key="g.title">
          <div class="mb-1 flex items-center justify-between text-xs">
            <span class="font-semibold uppercase tracking-wide text-darkest">{{ g.title }}</span>
            <span class="space-x-2 text-darker">
              <button type="button" class="hover:text-dark" @click="show(g.defs.map((d) => d.id), true)">All</button>
              <button type="button" class="hover:text-dark" @click="show(g.defs.map((d) => d.id), false)">None</button>
            </span>
          </div>
          <div class="grid grid-cols-2 gap-1">
            <label
              v-for="d in g.defs"
              :key="d.id"
              class="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-dark"
            >
              <input type="checkbox" class="accent-accent" :checked="shown(d.id)" @change="show([d.id], ($event.target as HTMLInputElement).checked)" />
              <img v-if="portrait(d)" :src="portrait(d)!" alt="" loading="lazy" class="size-5 shrink-0 rounded object-cover" />
              <span class="truncate">{{ d.name }}</span>
            </label>
          </div>
        </div>
        <p class="text-[11px] text-darkest">Only the timers shown can alert.</p>
      </div>
    </section>

    <p class="-mt-1 text-[11px] text-darkest">
      Local time, soonest first. An alert starts as early as its menu says; a click on the bubble
      dismisses it and shows it here. Field bosses update when you open the map.
    </p>

    <section>
      <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-darkest">Alerts</h3>
      <div class="divide-y divide-[color:var(--gray-4)] rounded-lg border border-card bg-card px-3">
        <SettingRow label="Server region" hint="Weekly events (the siege) are at your region's own time.">
          <select
            :value="cfg.region"
            class="h-7 rounded-md border border-light bg-default px-2 text-sm"
            @change="set({ region: ($event.target as HTMLSelectElement).value as Region })"
          >
            <option v-for="r in REGIONS" :key="r.id" :value="r.id">{{ r.label }}{{ r.confirmed ? '' : ' (unconfirmed)' }}</option>
          </select>
        </SettingRow>
        <SettingRow label="Sound" hint="A soft chime when an alert starts.">
          <Toggle :model-value="cfg.sound" @update:model-value="set({ sound: $event })" />
        </SettingRow>
        <SettingRow label="Volume">
          <div class="flex items-center gap-2">
            <Slider :model-value="cfg.volume" :min="0.1" :max="1" :step="0.05" :format="pct" @update:model-value="set({ volume: $event })" />
            <Button size="sm" @click="playChime(cfg.volume)">Test</Button>
          </div>
        </SettingRow>
        <SettingRow label="Shake the bubble" hint="Every few seconds while an alert is up.">
          <Toggle :model-value="cfg.shake" @update:model-value="set({ shake: $event })" />
        </SettingRow>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* The rows slide to their new place when the order changes (a timer goes past its start). */
.reorder-move {
  transition: transform 400ms ease;
}
</style>
