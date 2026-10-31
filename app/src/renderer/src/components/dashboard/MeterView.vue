<script setup lang="ts">
// Combat Meter: the fight as the meter overlay sees it, larger, from A2Tools DPS Meter's parser.
// Which targets and players it counts and what it ranks by (shared with the overlay), each player's
// numbers (a click opens their details), the meter and My skills overlays' settings, and recordings
// of the game's traffic.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import MeterSizeSettings from '@/components/MeterSizeSettings.vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import Segmented from '@/components/ui/Segmented.vue'
import { bridge } from '@/lib/bridge.ts'
import { loc, t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import SelectBox from '@/components/ui/SelectBox.vue'
import {
  CLASS_COLORS,
  MAIN_TARGET_MODES,
  METER_PLAYERS,
  METER_STATS,
  meterRows,
  NO_METER,
  NO_RECORDINGS,
  TARGET_MODE_LABELS,
  timeToKill,
  type MeterData,
  type Recordings,
  type TargetMode,
} from '@shared/meter.ts'

const store = useApp()
const api = bridge()
const meter = ref<MeterData>(NO_METER)
const cfg = computed(() => store.settings.meter)
const skills = computed(() => store.settings.skills)

const icons = import.meta.glob<string>('@/assets/classes/*.png', { eager: true, import: 'default' })
const icon = (className: string | null): string | null => (className ? (icons[`/src/assets/classes/${className.toLowerCase()}.png`] ?? null) : null)

function short(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`
  return Math.round(n).toLocaleString('en-US')
}
const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const rows = computed(() => meterRows(meter.value, cfg.value.players, cfg.value.stat))
const top = computed(() => Math.max(1, ...rows.value.map((r) => r.value)))
const perSecond = computed(() => rows.value.reduce((n, r) => n + r.perSecond, 0))
const total = computed(() => rows.value.reduce((n, r) => n + r.value, 0))
const ttk = computed(() => timeToKill(meter.value))
const UNIT = { damage: ['DPS', 'Damage'], healing: ['HPS', 'Healed'], taken: ['Per second', 'Taken'] } as const
const hp = computed(() => {
  const t = meter.value.target
  return t && t.maxHp > 0 && t.hp !== null ? Math.min(1, Math.max(0, t.hp / t.maxHp)) : null
})
const pingClass = computed(() => {
  const ms = meter.value.ping
  return ms === null ? 'text-darker' : ms < 80 ? 'text-green' : ms < 150 ? 'text-yellow' : 'text-danger'
})

const MORE = (['mostDamage', 'mostRecent', 'trainTargets'] as const).map((id) => ({ id, label: TARGET_MODE_LABELS[id] }))
const isMore = computed(() => MORE.some((m) => m.id === cfg.value.targetMode))
const empty = computed(() => {
  const st = store.status?.state
  if (st !== 'locked') return [t('Waiting for the game'), t('The meter fills in once the game is running.')]
  if (!meter.value.meKnown) return [t('Detecting character…'), t('Change zone or log in so the meter knows who you are.')]
  if (meter.value.rows.length) return [t('Nothing to show'), cfg.value.players === 'me' ? t('None of yours on this target.') : t('Nothing of this on the target yet.')]
  return [t('Waiting for a fight'), t('The meter fills in as soon as you or your party hit something.')]
})

// Recordings of the game's traffic: replayed with the engine's --replay after a game patch.
const rec = ref<Recordings>(NO_RECORDINGS)
const size = (b: number): string => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)
const when = (ms: number): string => new Date(ms).toLocaleString(loc(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const setMeter = (patch: Partial<typeof cfg.value>): void => void store.set('meter', { ...cfg.value, ...patch })
const setSkills = (patch: Partial<typeof skills.value>): void => void store.set('skills', { ...skills.value, ...patch })
const pct = (v: number): string => `${Math.round(v * 100)}%`
function details(actor: number): void {
  const target = meter.value.target?.id
  if (target) void api.invoke('details:open', { kind: 'live', target, actor })
}

const offs: (() => void)[] = []
onMounted(async () => {
  offs.push(api.on('meter:dps', (m) => (meter.value = m)))
  offs.push(api.on('recordings:changed', (r) => (rec.value = r)))
  meter.value = await api.invoke('meter:get')
  rec.value = await api.invoke('recordings:get')
})
onBeforeUnmount(() => offs.forEach((off) => off()))
</script>

<template>
  <div>
    <PageHeader title="Combat Meter" about="Damage of you and your party, decoded live from the game's network traffic by A2Tools DPS Meter's parser. Nothing is read from or written to the game itself.">
      <Button @click="api.invoke('meter:reset')">
        <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v3h-3" /></svg>
        {{ t('Reset') }}
      </Button>
    </PageHeader>

    <div class="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-card bg-card px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium uppercase tracking-wide text-darker">{{ t('Targets') }}</span>
        <Segmented :model-value="isMore ? null : cfg.targetMode" :options="MAIN_TARGET_MODES" size="sm" @update:model-value="$event && setMeter({ targetMode: $event })" />
        <SelectBox
          size="sm"
          :model-value="isMore ? cfg.targetMode : ('' as TargetMode)"
          :options="[{ id: '' as TargetMode, label: 'More…' }, ...MORE]"
          @update:model-value="$event && setMeter({ targetMode: $event })"
        />
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium uppercase tracking-wide text-darker">{{ t('Players') }}</span>
        <Segmented :model-value="cfg.players" :options="METER_PLAYERS" size="sm" @update:model-value="setMeter({ players: $event })" />
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium uppercase tracking-wide text-darker">{{ t('Show') }}</span>
        <Segmented :model-value="cfg.stat" :options="METER_STATS" size="sm" @update:model-value="setMeter({ stat: $event })" />
      </div>
    </div>

    <Section bare>
      <div class="overflow-hidden rounded-xl border border-card">
        <div class="flex items-center gap-4 border-b border-card bg-card px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="truncate text-base font-semibold">{{ meter.target?.name || t('No target yet') }}</div>
            <div class="text-xs tabular-nums text-darker">
              <template v-if="meter.battleTime">{{ clock(meter.battleTime) }} · {{ short(total) }} {{ t(UNIT[cfg.stat][1]).toLowerCase() }} · {{ short(perSecond) }} {{ UNIT[cfg.stat][0] === 'Per second' ? t('per second') : UNIT[cfg.stat][0] }}</template>
              <template v-else>{{ t('Hit something and the fight shows here.') }}</template>
            </div>
          </div>
          <div v-if="hp !== null" class="w-56">
            <div class="mb-0.5 flex justify-between text-[11px] tabular-nums text-darker">
              <span>HP<template v-if="ttk !== null"> · {{ t('dies in {time}', { time: clock(ttk) }) }}</template></span><span>{{ (hp * 100).toFixed(1) }}% · {{ short(meter.target!.hp!) }}</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-dark"><div class="h-full bg-danger" :style="{ width: `${hp * 100}%` }" /></div>
          </div>
          <div v-if="meter.ping !== null" class="text-right text-xs text-darker" :title="t('Your ping to the game server')">
            <div :class="['text-base font-semibold tabular-nums', pingClass]">{{ meter.ping }}<span class="text-xs font-normal"> ms</span></div>
            ping
          </div>
        </div>
        <table v-if="rows.length" class="w-full text-sm">
          <thead class="text-xs uppercase tracking-wide text-darker">
            <tr class="border-b border-card">
              <th class="w-10 py-2 pl-4 text-left font-medium">#</th>
              <th class="text-left font-medium">{{ t('Player') }}</th>
              <th class="w-28 px-3 text-right font-medium">{{ t(UNIT[cfg.stat][0]) }}</th>
              <th class="w-28 px-3 text-right font-medium">{{ t(UNIT[cfg.stat][1]) }}</th>
              <th class="w-20 px-3 text-right font-medium">{{ t('Share') }}</th>
              <th class="w-20 pr-4 text-right font-medium">{{ cfg.stat === 'damage' ? 'Crit' : '' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in rows"
              :key="r.id"
              class="relative cursor-pointer border-b border-card/60 last:border-0 hover:bg-card"
              :title="t('{class}: click for skills', { class: r.className ?? t('Unknown class') })"
              @click="details(r.id)"
            >
              <td class="py-1.5 pl-4 text-xs tabular-nums text-darkest">{{ i + 1 }}</td>
              <td class="py-1.5">
                <div class="relative flex items-center gap-2">
                  <img v-if="icon(r.className)" :src="icon(r.className)!" class="size-5 shrink-0" alt="" />
                  <span v-else class="size-5 shrink-0" />
                  <span :class="['truncate', r.you ? 'font-semibold text-yellow' : '']">{{ r.name }}</span>
                </div>
                <div class="mt-1 h-1 overflow-hidden rounded-full bg-dark">
                  <div class="h-full" :style="{ width: `${(r.value / top) * 100}%`, background: CLASS_COLORS[r.className ?? ''] ?? '#787b8a' }" />
                </div>
              </td>
              <td class="px-3 text-right font-medium tabular-nums">{{ short(r.perSecond) }}</td>
              <td class="px-3 text-right tabular-nums text-darker">{{ short(r.value) }}</td>
              <td class="px-3 text-right tabular-nums text-darker">{{ r.part.toFixed(1) }}%</td>
              <td class="pr-4 text-right tabular-nums text-darker">{{ cfg.stat === 'damage' ? `${Math.round(r.critRate * 100)}%` : '' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="flex flex-col items-center gap-1 px-4 py-10 text-center">
          <div class="text-sm font-medium">{{ empty[0] }}</div>
          <div class="text-xs text-darker">{{ empty[1] }}</div>
        </div>
      </div>
    </Section>

    <Section title="Meter overlay" icon="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5">
      <SettingRow label="Show the meter over the game" hint="Its own window while the game is open: drag it by its header, click a player for their skills.">
        <Toggle :model-value="cfg.enabled" @update:model-value="setMeter({ enabled: $event })" />
      </SettingRow>
      <SettingRow v-if="cfg.enabled && cfg.height === null" label="Players listed" hint="With a height of its own, the meter lists every player it fits.">
        <Slider :model-value="cfg.rows" :min="1" :max="24" :step="1" @update:model-value="setMeter({ rows: $event })" />
      </SettingRow>
      <SettingRow v-if="cfg.enabled" label="Opacity">
        <Slider :model-value="cfg.opacity" :min="0.3" :max="1" :step="0.05" :format="pct" @update:model-value="setMeter({ opacity: $event })" />
      </SettingRow>
      <MeterSizeSettings v-if="cfg.enabled" />
    </Section>

    <Section title="Recordings" icon="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z">
      <template #actions>
        <Button size="sm" :disabled="!rec.dir" @click="api.invoke('recordings:open')">{{ t('Open folder') }}</Button>
        <Button size="sm" :intent="rec.recording ? 'danger' : 'default'" :disabled="store.status?.state !== 'locked' && !rec.recording" @click="api.invoke('recordings:set', !rec.recording)">
          <span :class="['size-2 rounded-full', rec.recording ? 'animate-pulse bg-danger' : 'bg-danger/70']" />
          {{ rec.recording ? t('Stop recording') : t('Start recording') }}
        </Button>
      </template>
      <p class="py-3 text-sm text-darker">
        {{ t("A recording keeps the game's traffic during a fight, so the meter can be checked and fixed against it after a game patch. They stay on this computer.") }}
      </p>
      <div v-for="f in rec.files.slice(0, 8)" :key="f.path" class="flex items-center gap-3 py-2 text-sm">
        <span v-if="f.path === rec.recording" class="size-2 animate-pulse rounded-full bg-danger" />
        <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ f.name }}</span>
        <span class="text-xs tabular-nums text-darker">{{ size(f.bytes) }}</span>
        <span class="w-32 text-right text-xs text-darker">{{ when(f.modified) }}</span>
      </div>
      <p v-if="!rec.files.length" class="py-3 text-sm text-darkest">{{ t('No recordings yet.') }}</p>
    </Section>

    <Section title="My skills overlay" icon="M8 1.5 9.8 6l4.7.4-3.6 3 1.1 4.6L8 11.6 4 14l1.1-4.6-3.6-3L6.2 6z">
      <SettingRow label="Show my skills over the game" hint="Your own damage on the meter's target, skill by skill: DPS, share and damage of each.">
        <Toggle :model-value="skills.enabled" @update:model-value="setSkills({ enabled: $event })" />
      </SettingRow>
      <SettingRow v-if="skills.enabled" label="Skills listed">
        <Slider :model-value="skills.rows" :min="1" :max="20" :step="1" @update:model-value="setSkills({ rows: $event })" />
      </SettingRow>
      <SettingRow v-if="skills.enabled" label="Opacity">
        <Slider :model-value="skills.opacity" :min="0.3" :max="1" :step="0.05" :format="pct" @update:model-value="setSkills({ opacity: $event })" />
      </SettingRow>
    </Section>
  </div>
</template>
