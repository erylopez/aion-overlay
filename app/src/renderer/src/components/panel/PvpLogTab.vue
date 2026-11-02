<script setup lang="ts">
// Copied from Nyerk (GPL-3.0), https://github.com/xCROv/aion2-nyerk
// app/src/renderer/src/components/panel/PvpLogTab.vue at ddcdc48 (0.2.17).
// The PvP kill feed: every player killed by a player around you this session, newest first, as the
// game credits it (the killing blow). Your kills in green, your deaths in red; players from other
// servers carry their server's tag ([LUM]).
import { computed, onBeforeUnmount, ref } from 'vue'
import Button from '@/components/Button.vue'
import ClassIcon from '@/components/ClassIcon.vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import SoundPicker from '@/components/SoundPicker.vue'
import Toggle from '@/components/Toggle.vue'
import { bridge } from '@/lib/bridge.ts'
import { loc, plural, t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import { serverTag } from '@shared/servers.ts'
import type { Settings } from '@shared/settings.ts'
import type { PvpKill } from '@shared/tracker.ts'

const store = useApp()
const kills = computed(() => [...store.pvp].reverse())
const myServer = computed(() => store.status?.server ?? null)
/** Combat power as the game rounds it: 115485 → 115.4K. */
const cp = (v: number): string => `${(Math.floor(v / 100) / 10).toFixed(1)}K`
const tag = (server: number | null): string | null => (server === null || server === myServer.value ? null : serverTag(server))
// One filter at a time; clicking the active one shows everything again.
type Filter = 'mine' | 'legion'
const filters: { id: Filter; label: string; title: string; empty: string }[] = [
  { id: 'mine', label: 'Mine', title: 'Your kills and deaths', empty: 'No kills or deaths of yours yet.' },
  { id: 'legion', label: 'My Guild', title: "Kills and deaths of your legion's members, yours included", empty: 'No kills or deaths of your legion yet.' },
]
const filter = ref<Filter | null>(null)
function pick(id: Filter): void {
  filter.value = filter.value === id ? null : id
  limit.value = PAGE
}
const filtered = computed(() =>
  filter.value === 'mine' ? kills.value.filter((k) => k.mine || k.died) : filter.value === 'legion' ? kills.value.filter((k) => k.legion) : kills.value,
)
// The newest rows only (a siege lists thousands); more on request.
const PAGE = 200
const limit = ref(PAGE)
const shown = computed(() => filtered.value.slice(0, limit.value))
const counts = computed(() => ({
  kills: store.pvp.filter((k) => k.mine).length,
  deaths: store.pvp.filter((k) => k.died).length,
}))

// "2 min ago": redrawn every 15 s.
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 15_000)
onBeforeUnmount(() => clearInterval(ticker))
const time = (ms: number): string => new Date(ms).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })
function ago(ms: number): string {
  const s = Math.max(0, Math.round((now.value - ms) / 1000))
  if (s < 60) return t('just now')
  const m = Math.round(s / 60)
  return m < 60 ? t('{n} min ago', { n: m }) : time(ms)
}
const rowClass = (k: PvpKill): string =>
  k.mine ? 'bg-green/10 border-l-2 border-green' : k.died ? 'bg-danger/10 border-l-2 border-danger' : 'border-l-2 border-transparent'
const clear = (): void => void bridge().invoke('tracker:clearPvp')
/** A kill you took part in, its fight in the Details window: each side's damage and skills. */
const openFight = (k: PvpKill): void => {
  if (k.fight) void bridge().invoke('details:open', { kind: 'pvp', id: k.fight })
}
const fightTitle = (k: PvpKill): string | undefined =>
  k.fight ? t('Show the fight: damage and skills, yours and theirs') : k.mine || k.died ? t('No hits between you were seen before this one') : undefined
/** The kill feed over the game (its own small window). */
const hudOpen = computed(() => store.settings.killFeed.open)
const toggleHud = (): void => void bridge().invoke(hudOpen.value ? 'killfeed:close' : 'killfeed:open')

// The overlays over the game, set up here: the kill feed's look, and Enemies nearby.
const setKillFeed = (patch: Partial<Settings['killFeed']>): void => void store.set('killFeed', { ...store.settings.killFeed, ...patch })
const setEnemies = (patch: Partial<Settings['enemies']>): void => void store.set('enemies', { ...store.settings.enemies, ...patch })
const background = (v: number): string => (v === 0 ? t('None') : `${Math.round(v * 100)}%`)
const BACKGROUND_HINT = 'At None the text keeps a dark glow, readable on the game.'
</script>

<template>
  <div class="space-y-3 p-3">
    <div class="flex items-center gap-2 text-xs">
      <span class="rounded-md bg-card px-2 py-1"><span class="font-semibold text-green">{{ counts.kills }}</span> kills</span>
      <span class="rounded-md bg-card px-2 py-1"><span class="font-semibold text-danger">{{ counts.deaths }}</span> {{ t('deaths') }}</span>
      <Button size="sm" class="ml-auto" :disabled="!store.pvp.length" @click="clear">{{ t('Clear') }}</Button>
      <Button size="sm" :intent="hudOpen ? 'default' : 'primary'" :title="hudOpen ? t('Close the kill feed over the game') : t('A small kill feed over the game')" @click="toggleHud">
        {{ hudOpen ? t('Close HUD') : t('Open HUD') }}
      </Button>
    </div>

    <div class="flex items-center gap-1.5 text-xs">
      <button
        v-for="f in filters"
        :key="f.id"
        type="button"
        :title="t(f.title)"
        :class="['rounded-full border px-2.5 py-0.5', filter === f.id ? 'border-accent bg-accent/15 text-default' : 'border-light text-darker hover:text-dark']"
        @click="pick(f.id)"
      >
        {{ t(f.label) }}
      </button>
      <!-- How many kills the list below holds (with the filter). -->
      <span class="ml-auto rounded-full bg-card px-2 py-0.5 tabular-nums text-dark" :title="plural(filtered.length, '{n} kill in the list', '{n} kills in the list')">{{ filtered.length }}</span>
    </div>

    <ul v-if="filtered.length" class="divide-y divide-[color:var(--line)] overflow-hidden rounded-lg border border-card bg-card">
      <li
        v-for="(k, i) in shown"
        :key="`${k.at}-${i}`"
        :class="['flex items-center gap-2 px-3 py-2 text-sm', rowClass(k), k.fight && 'cursor-pointer hover:bg-dark']"
        :title="fightTitle(k)"
        @click="openFight(k)"
      >
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5">
            <ClassIcon :class-name="k.killer.className" :size="16" />
            <span class="truncate font-medium" :class="k.mine && 'text-green'">{{ k.killer.name }}</span>
            <span v-if="tag(k.killer.server)" class="shrink-0 text-[11px] text-yellow">[{{ tag(k.killer.server) }}]</span>
            <span v-if="k.killer.combatPower" class="shrink-0 text-[11px] font-semibold tabular-nums text-yellow" :title="t('Combat power')">{{ cp(k.killer.combatPower) }}</span>
            <svg viewBox="0 0 16 16" class="size-3.5 shrink-0 text-darker" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path d="M3 8h9M9 4.5 12.5 8 9 11.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <ClassIcon :class-name="k.victim?.className" :size="16" />
            <span class="truncate font-medium" :class="k.died && 'text-danger'">{{ k.victim?.name ?? t('a player out of view') }}</span>
            <span v-if="k.victim && tag(k.victim.server)" class="shrink-0 text-[11px] text-yellow">[{{ tag(k.victim.server) }}]</span>
            <span v-if="k.victim?.combatPower" class="shrink-0 text-[11px] font-semibold tabular-nums text-yellow" :title="t('Combat power')">{{ cp(k.victim.combatPower) }}</span>
          </div>
          <div v-if="k.killer.guild" class="truncate text-[11px] text-darker">{{ k.killer.guild }}</div>
        </div>
        <span v-if="k.fight && !k.mine && !k.died" class="shrink-0 rounded bg-accent/15 px-1.5 text-[10px] font-semibold text-accent" :title="t('You fought this player before someone else took the kill')">Assist</span>
        <span v-if="k.fight" class="shrink-0 text-[11px] font-medium text-accent">{{ t('Details') }} ›</span>
        <span class="shrink-0 text-[11px] tabular-nums text-darker" :title="time(k.at)">{{ ago(k.at) }}</span>
      </li>
    </ul>
    <button
      v-if="filtered.length > shown.length"
      type="button"
      class="w-full rounded-lg border border-card bg-card py-1.5 text-xs text-darker hover:text-dark"
      @click="limit += PAGE"
    >
      {{ t('Show older ({n} more)', { n: filtered.length - shown.length }) }}
    </button>
    <p v-if="!filtered.length" class="rounded-lg border border-card bg-card px-3 py-6 text-center text-sm text-darker">
      {{ t(filters.find((f) => f.id === filter)?.empty ?? 'No player kills seen yet.') }}
    </p>

    <section class="rounded-lg border border-card bg-card px-3">
      <h3 class="pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-darker">{{ t('Overlays over the game') }}</h3>
      <div class="divide-y divide-[color:var(--line)]">
        <SettingRow label="Kill feed" hint="This session's kills and deaths, and each player kill around you as it happens.">
          <Toggle :model-value="hudOpen" @update:model-value="toggleHud" />
        </SettingRow>
        <template v-if="hudOpen">
          <SettingRow label="Your target" hint="Under the kills and deaths: the player you last targeted, with level, server, class and combat power (enemies in red). For 2 minutes, or until you target another.">
            <Toggle :model-value="store.settings.killFeed.target" @update:model-value="setKillFeed({ target: $event })" />
          </SettingRow>
          <SettingRow label="Kill feed background" :hint="BACKGROUND_HINT">
            <Slider :model-value="store.settings.killFeed.opacity" :min="0" :max="1" :step="0.05" :format="background" @update:model-value="setKillFeed({ opacity: $event })" />
          </SettingRow>
        </template>
        <SettingRow label="Enemies nearby" hint="Players of the other faction your game has loaded around you, with server, combat power and legion. Hidden while there are none; drag it while this window is open.">
          <Toggle :model-value="store.settings.enemies.enabled" @update:model-value="setEnemies({ enabled: $event })" />
        </SettingRow>
        <template v-if="store.settings.enemies.enabled">
          <SettingRow label="Enemies on the map" hint="A pin on the map overlay where each enemy was last seen: as they come into view, then as effects and skills land on them. Red when they can attack you (PvP on, or anyone in the Abyss), grey with their PvP off.">
            <Toggle :model-value="store.settings.enemies.mapPins" @update:model-value="setEnemies({ mapPins: $event })" />
          </SettingRow>
          <SettingRow label="Enemies background" :hint="BACKGROUND_HINT">
            <Slider :model-value="store.settings.enemies.opacity" :min="0" :max="1" :step="0.05" :format="background" @update:model-value="setEnemies({ opacity: $event })" />
          </SettingRow>
          <SettingRow label="Sound for an enemy" hint="When one comes into view (the same player at most once a minute).">
            <Toggle :model-value="store.settings.enemies.sound" @update:model-value="setEnemies({ sound: $event })" />
          </SettingRow>
          <template v-if="store.settings.enemies.sound">
            <SettingRow label="Only enemies with PvP on" hint="The sound only for those who can attack you: with their PvP on, or anyone in the Abyss. The list shows them all, PvP on first, with a PvP mark.">
              <Toggle :model-value="store.settings.enemies.pvpOnly" @update:model-value="setEnemies({ pvpOnly: $event })" />
            </SettingRow>
            <SoundPicker kind="enemy" label="Enemy sound" />
          </template>
        </template>
      </div>
    </section>

    <p class="text-[11px] text-darkest">
      {{ t('Player kills around you, as the game credits them: the killing blow only, so an assist is not a kill here. Kept until you clear them, across restarts.') }}
    </p>
  </div>
</template>
