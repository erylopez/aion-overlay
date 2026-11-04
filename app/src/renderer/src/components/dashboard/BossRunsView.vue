<script setup lang="ts">
// Boss Runs: Verteron's field bosses in the order they spawn, each with its Kibelisk as chat calls
// it ("Dartan, TP 33"), and the settings of the list over the game (pages/BossRunsPage.vue). The
// ones within the list's look-ahead are marked: those are what the list over the game shows. Each
// can be marked low priority, left out of the bosses alive that bring the list up.
import { computed, onBeforeUnmount, ref } from 'vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import Countdown from '@/components/ui/Countdown.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import SelectBox from '@/components/ui/SelectBox.vue'
import { t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import { BOSS_RUNS, CLUSTER_GAP_MS } from '@shared/bossRuns.ts'
import { bossPortrait, bossState } from '@shared/timers.ts'

const store = useApp()
const runs = computed(() => store.settings.bossRuns)
const setRuns = (patch: Partial<typeof runs.value>): void => void store.set('bossRuns', { ...runs.value, ...patch })
const pct = (v: number): string => `${Math.round(v * 100)}%`
const WINDOWS = [5, 10, 15, 20, 30, 45, 60]
const ROW_CHOICES = [3, 4, 5, 6, 7, 8, 10]
const ALIVE_CHOICES = [0, 2, 3, 4, 5, 6, 8]
const isLow = (boss: number): boolean => runs.value.lowPriority.includes(boss)
const setLow = (boss: number, low: boolean): void =>
  setRuns({ lowPriority: low ? [...runs.value.lowPriority, boss] : runs.value.lowPriority.filter((b) => b !== boss) })

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(ticker))

/** Alive first, then by when each spawns; the ones with no time known last. */
const rows = computed(() =>
  BOSS_RUNS.map((run) => {
    const state = bossState(run.boss, store.fieldBosses, now.value, store.settings.timers.region)
    const known = state && (state.up || state.at > 0) ? state : null
    return { run, state: known, rank: !known ? 2 : known.up ? 0 : 1, portrait: bossPortrait(run.boss) }
  }).sort((a, b) => a.rank - b.rank || (a.state?.at ?? 0) - (b.state?.at ?? 0)),
)
const soon = (at: number): boolean => at - now.value <= runs.value.windowMinutes * 60_000
</script>

<template>
  <div>
    <PageHeader
      title="Boss Runs"
      :about="t('Verteron\'s field bosses in the order they spawn, each with its Kibelisk. The list over the game comes up by itself when more than 2 bosses spawn within {n} minutes of each other.', { n: CLUSTER_GAP_MS / 60_000 })"
    />

    <Section title="Over the game">
      <SettingRow label="Boss Runs list" hint="Stays while any boss of the run is left. A boss killed near you, or listed dead again by the map, is struck out, then fades out. Move it by its header, size it by its corner; its X hides it until the next run.">
        <Toggle :model-value="runs.enabled" @update:model-value="setRuns({ enabled: $event })" />
      </SettingRow>
      <template v-if="runs.enabled">
        <SettingRow label="Looks ahead" hint="Bosses spawning within this time are listed.">
          <SelectBox size="sm" :model-value="runs.windowMinutes" :options="WINDOWS.map((m) => ({ id: m, label: t('{n} min', { n: m }) }))" @update:model-value="setRuns({ windowMinutes: $event })" />
        </SettingRow>
        <SettingRow label="When alive" hint="It also comes up when this many bosses are alive at once.">
          <SelectBox size="sm" :model-value="runs.aliveMin" :options="ALIVE_CHOICES.map((n) => ({ id: n, label: n ? t('{n} or more', { n }) : t('Never') }))" @update:model-value="setRuns({ aliveMin: $event })" />
        </SettingRow>
        <SettingRow v-if="runs.aliveMin" label="Ignore low priority bosses" hint="The ones marked low priority in the table below don't count toward the bosses alive.">
          <Toggle :model-value="runs.ignoreLow" @update:model-value="setRuns({ ignoreLow: $event })" />
        </SettingRow>
        <SettingRow label="Bosses" hint="At most this many at once.">
          <SelectBox size="sm" :model-value="runs.rows" :options="ROW_CHOICES.map((n) => ({ id: n, label: String(n) }))" @update:model-value="setRuns({ rows: $event })" />
        </SettingRow>
        <SettingRow label="Opacity">
          <Slider :model-value="runs.opacity" :min="0" :max="1" :step="0.05" :format="pct" @update:model-value="setRuns({ opacity: $event })" />
        </SettingRow>
      </template>
    </Section>

    <Section title="Next to spawn" bare>
      <div class="overflow-hidden rounded-xl border border-card">
        <table class="w-full text-sm">
          <thead class="bg-card text-xs uppercase tracking-wide text-darker">
            <tr class="border-b border-card">
              <th class="py-2.5 pl-4 text-left font-medium">Boss</th>
              <th class="w-20 px-3 text-left font-medium">TP</th>
              <th class="px-3 text-left font-medium">Kibelisk</th>
              <th class="w-40 px-3 text-right font-medium">{{ t('Status') }}</th>
              <th class="w-32 pr-4 text-right font-medium" :title="t('Low priority bosses don\'t count toward the bosses alive that bring the list up')">{{ t('Low priority') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[color:var(--line)]">
            <tr v-for="r in rows" :key="r.run.boss" :class="['hover:bg-card', (!r.state || (!r.state.up && !soon(r.state.at))) && 'opacity-60']">
              <td class="py-2 pl-4">
                <div class="flex items-center gap-3">
                  <img v-if="r.portrait" :src="r.portrait" alt="" loading="lazy" draggable="false" class="size-8 shrink-0 rounded-lg border border-card object-cover" />
                  <span class="font-medium">{{ r.run.short }}</span>
                </div>
              </td>
              <td class="px-3">
                <span v-if="r.run.tp !== null" class="rounded bg-yellow/15 px-1.5 text-[11px] font-semibold leading-5 text-yellow">TP {{ r.run.tp }}</span>
              </td>
              <td class="px-3 text-xs text-darker">{{ r.run.tpName }}</td>
              <td class="px-3 text-right">
                <span v-if="!r.state" class="text-darkest">{{ t('Not seen') }}</span>
                <span v-else-if="r.state.up" class="font-medium text-green">{{ t('Alive') }}</span>
                <span v-else-if="r.state.at <= now" class="text-yellow">{{ t('Due') }}</span>
                <span v-else :class="['font-medium tabular-nums', soon(r.state.at) ? 'text-yellow' : 'text-default']"><Countdown :at="r.state.at" :now="now" /></span>
              </td>
              <td class="pr-4 text-right">
                <Toggle :model-value="isLow(r.run.boss)" @update:model-value="setLow(r.run.boss, $event)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  </div>
</template>
