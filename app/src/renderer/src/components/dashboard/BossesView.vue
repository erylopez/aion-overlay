<script setup lang="ts">
// Field Bosses: each one's state as your map last listed it (alive, or how long until it
// respawns), when that was, and its alert. The list comes from the game when you open the map; the
// Lokthar sync can fill in what others' maps saw. Verteron's bosses and the Abyss's (read as you
// enter the Abyss, by any of your characters) are known so far.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import Toggle from '@/components/Toggle.vue'
import Countdown from '@/components/ui/Countdown.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import SelectBox from '@/components/ui/SelectBox.vue'
import { bridge } from '@/lib/bridge.ts'
import { loc, t } from '@/lib/i18n.ts'
import { leadLabel, setAlert, setLead } from '@/lib/timerView.ts'
import { useApp } from '@/stores/app.ts'
import type { SyncResult } from '@shared/lokthar.ts'
import { bossPortrait, bossState, FIELD_BOSSES, leadChoices, TIMERS, type BossZone, type TimerDef } from '@shared/timers.ts'

const store = useApp()
const cfg = computed(() => store.settings.timers)
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(ticker))

const ZONES: { id: BossZone; label: string }[] = [
  { id: 'verteron', label: 'Verteron' },
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
              </div>
            </td>
            <td class="px-3 py-1.5">
              <span v-if="!r.state" class="text-darkest">{{ t('Not seen') }}</span>
              <template v-else-if="r.state.up">
                <div class="font-medium text-green">{{ t('Alive') }}</div>
                <div v-if="r.state.at" class="text-[11px] text-darker">{{ t('since {when}', { when: stamp(r.state.at) }) }}</div>
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
  </div>
</template>
