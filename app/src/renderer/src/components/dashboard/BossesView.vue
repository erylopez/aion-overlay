<script setup lang="ts">
// Field Bosses: each one's state as your map last listed it (alive, or how long until it
// respawns), when that was, and its alert. The list comes from the game when you open the map; the
// Lokthar sync can fill in what others' maps saw. Verteron's bosses, Altgard's (the Asmodians', from
// its map) and the Abyss's (read as you enter the Abyss, by any of your characters) are known so far. Below, the Boss Runs list's
// settings (pages/BossRunsPage.vue): Verteron's bosses about to spawn, with their Kibelisk.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import Countdown from '@/components/ui/Countdown.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import SelectBox from '@/components/ui/SelectBox.vue'
import { bridge } from '@/lib/bridge.ts'
import { loc, t } from '@/lib/i18n.ts'
import { leadLabel, setAlert, setLead } from '@/lib/timerView.ts'
import { useApp } from '@/stores/app.ts'
import { BOSS_RUNS, CLUSTER_GAP_MS } from '@shared/bossRuns.ts'
import type { SyncResult } from '@shared/lokthar.ts'
import { bossPortrait, bossState, FIELD_BOSSES, leadChoices, TIMERS, type BossZone, type TimerDef } from '@shared/timers.ts'

const store = useApp()
const cfg = computed(() => store.settings.timers)
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(ticker))

const ZONES: { id: BossZone; label: string }[] = [
  { id: 'verteron', label: 'Verteron' },
  { id: 'altgard', label: 'Asmodian bosses' },
  { id: 'abyss', label: 'Abyss' },
]
const zone = ref<BossZone>('verteron')

function ago(ms: number): string {
  const s = Math.max(0, Math.round((now.value - ms) / 1000))
  if (s < 60) return t('just now')
  const m = Math.round(s / 60)
  if (m < 60) return t('{n} min ago', { n: m })
  const h = Math.round(m / 60)
  return h < 48 ? t('{n} h ago', { n: h }) : t('{n} d ago', { n: Math.round(h / 24) })
}
/** "Oct 21, 14:56": the exact time a respawn or a read was, to check against the game's map. */
const stamp = (ms: number): string => new Date(ms).toLocaleString(loc(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Alive first, then by respawn, the ones never seen last. */
const rows = computed(() =>
  FIELD_BOSSES.filter((b) => b.zone === zone.value).map((b) => {
    const def = TIMERS.find((t) => t.schedule.kind === 'boss' && t.schedule.boss === b.boss) as TimerDef
    const state = bossState(b.boss, store.fieldBosses, now.value, cfg.value.region)
    const rank = !state ? 3 : state.up ? 0 : state.at < now.value ? 1 : 2
    return { ...b, def, state, rank, portrait: bossPortrait(b.boss) }
  }).sort((a, b) => a.rank - b.rank || (a.state?.at ?? 0) - (b.state?.at ?? 0) || a.name.localeCompare(b.name)),
)
const alive = computed(() => rows.value.filter((r) => r.state?.up).length)
// Lokthar sync, by hand: the list as your map last said, sent now, and how the site took it.
const hasToken = computed(() => !!store.settings.lokthar.token)
const syncResult = ref<SyncResult | null>(null)
const syncing = ref(false)
onMounted(async () => (syncResult.value = await bridge().invoke('lokthar:last')))
async function syncNow(): Promise<void> {
  syncing.value = true
  syncResult.value = await bridge().invoke('lokthar:sync')
  syncing.value = false
}
const runs = computed(() => store.settings.bossRuns)
const setRuns = (patch: Partial<typeof runs.value>): void => void store.set('bossRuns', { ...runs.value, ...patch })
const pct = (v: number): string => `${Math.round(v * 100)}%`
const WINDOWS = [5, 10, 15, 20, 30, 45, 60]
const ROW_CHOICES = [3, 4, 5, 6, 7, 8, 10]
/** "TP 33" as chat calls it, or the Kibelisk's name while its number is not known. */
function tpOf(boss: number): { label: string; title: string } | null {
  const r = BOSS_RUNS.find((x) => x.boss === boss)
  if (!r?.tpName) return null
  return { label: r.tp !== null ? `TP ${r.tp}` : r.tpName, title: t('Closest Kibelisk: {name}', { name: r.tpName }) }
}

const on = (def: TimerDef): boolean => (cfg.value.enabled[def.id] ?? false) && (cfg.value.shown[def.id] ?? false)
</script>

<template>
  <div>
    <PageHeader
      title="Field Bosses"
      about="When each field boss is up or respawns, from the game's own list: open the map in game to update it (the Abyss's bosses update each time you enter the Abyss). Turn on an alert to hear when one is due."
    />

    <div class="mb-4 flex items-center gap-4 border-b border-card">
      <button
        v-for="z in ZONES"
        :key="z.id"
        type="button"
        :class="['-mb-px border-b-2 px-1 pb-2 text-sm font-medium', zone === z.id ? 'border-accent text-default' : 'border-transparent text-darker hover:text-default']"
        @click="zone = z.id"
      >
        {{ t(z.label) }}
      </button>
      <span class="pb-2 text-xs text-darkest">{{ t("Other zones' bosses are not known yet.") }}</span>
      <span class="ml-auto pb-2 text-xs text-darker"><span class="font-semibold text-green">{{ alive }}</span> {{ t('alive') }}</span>
    </div>

    <div v-if="hasToken" class="mb-4 flex items-center gap-3 rounded-xl border border-card bg-card px-4 py-2.5 text-xs">
      <span class="font-medium text-default">{{ t('Lokthar sync') }}</span>
      <span v-if="syncResult" :class="['min-w-0 flex-1 truncate', syncResult.ok ? 'text-darker' : 'text-red']" :title="syncResult.message">
        {{ ago(syncResult.at) }}: {{ syncResult.message }}
      </span>
      <span v-else class="flex-1 text-darkest">{{ t('Not synced yet') }}</span>
      <Button size="sm" :disabled="syncing" :title="t('Send these bosses, as your map last listed them, to lokthar.com')" @click="syncNow">
        {{ syncing ? t('Syncing…') : t('Sync now') }}
      </Button>
    </div>

    <div class="overflow-hidden rounded-xl border border-card">
      <table class="w-full text-sm">
        <thead class="bg-card text-xs uppercase tracking-wide text-darker">
          <tr class="border-b border-card">
            <th class="py-2.5 pl-4 text-left font-medium">Boss</th>
            <th class="w-52 px-3 text-left font-medium">{{ t('Status') }}</th>
            <th class="w-36 px-3 text-left font-medium">{{ t('Last read') }}</th>
            <th class="w-44 px-3 text-left font-medium">{{ t('Alert me') }}</th>
            <th class="w-20 pr-4 text-right font-medium">{{ t('Alert') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[color:var(--line)]">
          <tr v-for="r in rows" :key="r.boss" class="hover:bg-card">
            <td class="py-2 pl-4">
              <div class="flex items-center gap-3">
                <img v-if="r.portrait" :src="r.portrait" alt="" loading="lazy" draggable="false" class="size-9 shrink-0 rounded-lg border border-card object-cover" />
                <span v-else class="grid size-9 shrink-0 place-items-center rounded-lg border border-card bg-card text-sm font-semibold text-darker">{{ r.name[0] }}</span>
                <span class="font-medium">{{ r.name }}</span>
                <span v-if="tpOf(r.boss)" :class="['rounded px-1.5 text-[11px] leading-5', tpOf(r.boss)!.label.startsWith('TP ') ? 'bg-yellow/15 font-semibold text-yellow' : 'text-darker']" :title="tpOf(r.boss)!.title">{{ tpOf(r.boss)!.label }}</span>
              </div>
            </td>
            <td class="px-3 py-1.5">
              <span v-if="!r.state" class="text-darkest">{{ t('Not seen') }}</span>
              <template v-else-if="r.state.up">
                <div class="font-medium text-green">{{ t('Alive') }}</div>
                <div v-if="r.state.at" class="text-[11px] text-darker">{{ t('since {when}', { when: stamp(r.state.at) }) }}</div>
              </template>
              <template v-else-if="r.state.killedAt && !r.state.at">
                <div class="font-medium text-red">{{ t('Killed') }}</div>
                <div class="text-[11px] text-darker">{{ t('{when}: open the map for its respawn', { when: stamp(r.state.killedAt) }) }}</div>
              </template>
              <template v-else-if="r.state.at <= now">
                <div class="text-yellow">{{ t('Due') }}</div>
                <div class="text-[11px] text-darker">{{ t('respawned {when}', { when: stamp(r.state.at) }) }}</div>
              </template>
              <template v-else>
                <div class="font-medium text-yellow">{{ t('Time left') }} <Countdown :at="r.state.at" :now="now" /></div>
                <div class="text-[11px] text-darker">{{ t('respawns {when}', { when: stamp(r.state.at) }) }}</div>
              </template>
            </td>
            <td class="px-3 text-xs text-darker">
              <div v-if="r.state?.source === 'schedule'" class="text-darkest" :title="t('The game gives it no time: its fixed schedule, as the game counts it')">{{ t('by its schedule') }}</div>
              <template v-else-if="r.state">
                <div>{{ ago(r.state.seen) }}<span v-if="r.state.source === 'shared'" class="text-darkest"> · {{ t('shared') }}</span></div>
                <div class="text-[11px] text-darkest">{{ stamp(r.state.seen) }}</div>
              </template>
            </td>
            <td class="px-3">
              <SelectBox
                v-if="on(r.def)"
                size="sm"
                :model-value="cfg.lead[r.def.id] ?? 0"
                :options="leadChoices(r.def).map((m) => ({ id: m, label: leadLabel(m) }))"
                @update:model-value="setLead(r.def.id, $event)"
              />
            </td>
            <td class="pr-4 text-right">
              <Toggle :model-value="on(r.def)" @update:model-value="setAlert(r.def.id, $event)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Section title="Boss Runs" class="mt-6">
      <div class="flex flex-wrap items-center gap-x-5 gap-y-3 py-3 text-sm">
        <label class="flex items-center gap-2" :title="t('Verteron\'s field bosses about to spawn, in order, with their Kibelisk. It comes up over the game when more than 2 spawn within {n} minutes of each other.', { n: CLUSTER_GAP_MS / 60_000 })">
          <Toggle :model-value="runs.enabled" @update:model-value="setRuns({ enabled: $event })" />
          <span>{{ t('Boss Runs list over the game') }}</span>
        </label>
        <template v-if="runs.enabled">
          <label class="flex items-center gap-2">
            <span class="text-xs font-medium uppercase tracking-wide text-darker">{{ t('Looks ahead') }}</span>
            <SelectBox size="sm" :model-value="runs.windowMinutes" :options="WINDOWS.map((m) => ({ id: m, label: t('{n} min', { n: m }) }))" @update:model-value="setRuns({ windowMinutes: $event })" />
          </label>
          <label class="flex items-center gap-2">
            <span class="text-xs font-medium uppercase tracking-wide text-darker">{{ t('Bosses') }}</span>
            <SelectBox size="sm" :model-value="runs.rows" :options="ROW_CHOICES.map((n) => ({ id: n, label: String(n) }))" @update:model-value="setRuns({ rows: $event })" />
          </label>
          <label class="flex items-center gap-2">
            <span class="text-xs font-medium uppercase tracking-wide text-darker">{{ t('Opacity') }}</span>
            <Slider :model-value="runs.opacity" :min="0" :max="1" :step="0.05" :format="pct" @update:model-value="setRuns({ opacity: $event })" />
          </label>
        </template>
      </div>
      <p class="pb-3 text-xs text-darker">
        {{ t('It comes up by itself when more than 2 bosses spawn within {n} minutes of each other, and stays while any is left. A boss killed near you, or listed dead again by the map, is struck out, then fades out. Drag it into place while this dashboard is open.', { n: CLUSTER_GAP_MS / 60_000 }) }}
      </p>
    </Section>
  </div>
</template>
