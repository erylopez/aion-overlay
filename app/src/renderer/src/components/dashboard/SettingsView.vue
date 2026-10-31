<script setup lang="ts">
// Settings: the app's own (who you are, the windows, privacy), the pets HUD, the Lokthar sync and
// the engine. Each overlay's own settings are on its page (the meter's on Combat Meter, the map's on
// Map...). Every change applies at once.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import StatusDot, { statusText } from '@/components/StatusDot.vue'
import MeterSizeSettings from '@/components/MeterSizeSettings.vue'
import SettingRow from '@/components/SettingRow.vue'
import SoundPicker from '@/components/SoundPicker.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import Segmented from '@/components/ui/Segmented.vue'
import SelectBox from '@/components/ui/SelectBox.vue'
import { bridge } from '@/lib/bridge.ts'
import { loc, plural, t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import type { SyncResult } from '@shared/lokthar.ts'
import { NO_PACKET_LOG, type PacketLog } from '@shared/meter.ts'
import { LANGS } from '@shared/i18n.ts'
import { serverLabel } from '@shared/servers.ts'

const store = useApp()
const info = ref<{ version: string; settingsFile: string; logFile: string } | null>(null)
onMounted(async () => (info.value = await bridge().invoke('app:info')))

const pct = (v: number): string => `${Math.round(v * 100)}%`


// The Lokthar sync: the site and its token, a connection check, and how the last post went.
const siteUrl = ref(store.settings.lokthar.url)
const token = ref(store.settings.lokthar.token)
const syncResult = ref<SyncResult | null>(null)
const testing = ref(false)
onMounted(async () => (syncResult.value = await bridge().invoke('lokthar:last')))
const saveLokthar = (patch: Partial<typeof store.settings.lokthar>): Promise<void> =>
  store.set('lokthar', { ...store.settings.lokthar, ...patch })
async function testSync(): Promise<void> {
  testing.value = true
  await saveLokthar({ url: siteUrl.value.trim(), token: token.value.trim() })
  syncResult.value = await bridge().invoke('lokthar:test')
  testing.value = false
}
/** Send the field bosses as your map last listed them, now. */
const syncing = ref(false)
async function syncNow(): Promise<void> {
  syncing.value = true
  await saveLokthar({ url: siteUrl.value.trim(), token: token.value.trim() })
  syncResult.value = await bridge().invoke('lokthar:sync')
  syncing.value = false
}
/**
 * Who you are, as the game says: your side (its zones first where a soul drops), your region (the
 * timers') and your level (the Nearby marks) all come from it. Before the game names you, the last
 * ones seen.
 */
const who = computed(() => {
  const s = store.status
  const level = s?.level ?? store.settings.playerLevel
  const parts = [
    s?.character,
    s?.server ? serverLabel(s.server) : store.settings.faction === 'asmodians' ? 'Asmodian' : 'Elyos',
    level ? `Lv ${level}` : null,
  ].filter(Boolean)
  return {
    value: parts.join(' · '),
    hint: s?.server
      ? 'Read from the game: your side, region and level follow your character.'
      : 'Read from the game when you enter the world; until then, the last ones seen.',
  }
})

const ago = (at: number): string => new Date(at).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })

const emit = defineEmits<{ go: [page: string] }>()


// Developer: the packet log, every game message as a text line, and marks to find them by.
const packetLog = ref<PacketLog>({ ...NO_PACKET_LOG })
const markText = ref('')
let offPackets: (() => void) | null = null
onMounted(async () => {
  offPackets = bridge().on('packets:state', (s) => (packetLog.value = s))
  packetLog.value = await bridge().invoke('packets:get')
})
onBeforeUnmount(() => offPackets?.())
const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path
function addMark(): void {
  void bridge().invoke('packets:mark', markText.value.trim())
  markText.value = ''
}
const OVERLAY_PAGES = [
  { page: 'meter', name: 'Damage meter and My skills', where: 'Combat Meter' },
  { page: 'buffs', name: 'Buffs', where: 'Buffs' },
  { page: 'map', name: 'Map', where: 'Map' },
  { page: 'events', name: 'Countdown bar', where: 'Event Alerts' },
  { page: 'pvp', name: 'Kill feed and Enemies nearby', where: 'PvP' },
]

const HUD_MODES = [
  { id: 'recent' as const, label: "This session's pets" },
  { id: 'pinned' as const, label: 'Pinned pets' },
]
const lastPacket = computed(() => {
  const ago = store.status?.lastPacketAgo
  return ago === null || ago === undefined ? t('never') : ago < 5 ? t('just now') : t('{n} s ago', { n: Math.round(ago) })
})
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <PageHeader title="Settings" />

    <Section title="Language" icon="M2 8h12M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2z">
      <SettingRow label="Language" hint="Game words (PvP, DPS, skills, buffs, bosses, pets...) stay as the community says them.">
        <Segmented :model-value="store.settings.language" :options="LANGS" @update:model-value="store.set('language', $event)" />
      </SettingRow>
    </Section>

    <Section title="General" icon="M2.5 3.5h11v9h-11zM2.5 6h11">
      <SettingRow label="Character" :hint="who.hint">
        <span class="text-sm text-dark">{{ who.value }}</span>
      </SettingRow>
      <SettingRow label="Sleep while Aion 2 is closed" hint="No overlays or capture until the game starts: only the tray icon, which still opens this window.">
        <Toggle :model-value="store.settings.sleepWithoutGame" @update:model-value="store.set('sleepWithoutGame', $event)" />
      </SettingRow>
      <SettingRow label="Hide when the game is not in front" hint="Alt-tab to another program and the overlays hide; they come back with the game.">
        <Toggle :model-value="store.settings.hideWhenGameAway" @update:model-value="store.set('hideWhenGameAway', $event)" />
      </SettingRow>
      <SettingRow label="Keep this window on top" hint="It stays above the game while open.">
        <Toggle :model-value="store.settings.panelOnTop" @update:model-value="store.set('panelOnTop', $event)" />
      </SettingRow>
      <SettingRow label="Hide when you click the game" hint="Click from this window into the game and it goes down to the taskbar; Alt+E brings it back.">
        <Toggle :model-value="store.settings.panelHideOnGame" @update:model-value="store.set('panelHideOnGame', $event)" />
      </SettingRow>
      <SettingRow label="Hide from screen recordings" hint="Keeps the overlays and this window out of OBS, Discord and screenshots.">
        <Toggle :model-value="store.settings.hideFromCapture" @update:model-value="store.set('hideFromCapture', $event)" />
      </SettingRow>
    </Section>

    <Section title="Overlays" icon="M8 1.5 14.5 5 8 8.5 1.5 5zM1.5 8 8 11.5 14.5 8M1.5 11 8 14.5 14.5 11">
      <button v-for="o in OVERLAY_PAGES" :key="o.page" type="button" class="flex w-full items-center justify-between gap-4 py-3 text-left hover:text-accent" @click="emit('go', o.page)">
        <span class="text-sm">{{ t(o.name) }}</span>
        <span class="flex items-center gap-1 text-xs text-darker">{{ t('on the {page} page', { page: t(o.where) }) }}
          <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 4 4 4-4 4" /></svg>
        </span>
      </button>
    </Section>

    <Section title="DPS Meter" icon="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5">
      <SettingRow label="Show the meter over the game" hint="Its own window while the game is open: drag it by its header, click a player for their skills.">
        <Toggle :model-value="store.settings.meter.enabled" @update:model-value="store.set('meter', { ...store.settings.meter, enabled: $event })" />
      </SettingRow>
      <MeterSizeSettings v-if="store.settings.meter.enabled" />
    </Section>

    <Section title="Pets HUD" icon="M5 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM11 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 9c-2 0-3.5 2-3.5 3.3 0 1 1 1.2 2.2 1.2.6 0 .9-.3 1.3-.3s.7.3 1.3.3c1.2 0 2.2-.2 2.2-1.2C11.5 11 10 9 8 9Z">
      <SettingRow label="Show the HUD" hint="Souls as they drop, the soul monsters around you and Hidden Cubes, over the game (borderless or windowed mode).">
        <Toggle :model-value="store.settings.hud.enabled" @update:model-value="store.setHud({ enabled: $event })" />
      </SettingRow>
      <template v-if="store.settings.hud.enabled">
        <SettingRow label="Nearby section" hint="At the top: the soul monsters around you, with the pet each drops.">
          <Toggle :model-value="store.settings.hud.nearby" @update:model-value="store.setHud({ nearby: $event })" />
        </SettingRow>
        <SettingRow v-if="store.settings.hud.nearby" label="How many nearby">
          <Slider :model-value="store.settings.hud.nearbyCount" :min="1" :max="8" :step="1" @update:model-value="store.setHud({ nearbyCount: $event })" />
        </SettingRow>
        <SettingRow label="Below it" :hint="({ pinned: 'Pin pets on the Pets page.', recent: 'Pets you gained souls for, latest first.' })[store.settings.hud.mode]">
          <SelectBox :model-value="store.settings.hud.mode" :options="HUD_MODES" @update:model-value="store.setHud({ mode: $event })" />
        </SettingRow>
        <SettingRow v-if="store.settings.hud.mode !== 'pinned'" label="How many this session">
          <Slider :model-value="store.settings.hud.recentCount" :min="1" :max="8" :step="1" @update:model-value="store.setHud({ recentCount: $event })" />
        </SettingRow>
        <SettingRow label="Soul pop-ups" hint="A line for each soul as it drops.">
          <Toggle :model-value="store.settings.hud.toasts" @update:model-value="store.setHud({ toasts: $event })" />
        </SettingRow>
        <SettingRow label="Kina per hour" hint="This session's Kina per hour, at the top right of the HUD.">
          <Toggle :model-value="store.settings.hud.kina" @update:model-value="store.setHud({ kina: $event })" />
        </SettingRow>
        <SettingRow label="Hidden Cubes" hint="A cube in view (the game tells you within about 100 m) at the top of the HUD, with how far and which way.">
          <Toggle :model-value="store.settings.hud.cubes" @update:model-value="store.setHud({ cubes: $event })" />
        </SettingRow>
        <SettingRow v-if="store.settings.hud.cubes" label="Sound for a cube" hint="When one comes into view.">
          <Toggle :model-value="store.settings.hud.cubeSound" @update:model-value="store.setHud({ cubeSound: $event })" />
        </SettingRow>
        <template v-if="store.settings.hud.cubes && store.settings.hud.cubeSound">
          <SoundPicker kind="cube" label="Cube sound" />
        </template>
        <SettingRow label="Hide without game traffic" hint="When the game has sent nothing for 15 seconds.">
          <Toggle :model-value="store.settings.hud.hideWithoutGame" @update:model-value="store.setHud({ hideWithoutGame: $event })" />
        </SettingRow>
        <SettingRow label="Clear between fights" hint="After this long with no kills or drops the HUD clears and hides until the next fight.">
          <Slider
            :model-value="store.settings.hud.idleHideSeconds"
            :min="0"
            :max="300"
            :step="15"
            :format="(v: number) => (v ? `${v}s` : t('Off'))"
            @update:model-value="store.setHud({ idleHideSeconds: $event })"
          />
        </SettingRow>
        <SettingRow label="Opacity">
          <Slider :model-value="store.settings.hud.opacity" :min="0.3" :max="1" :step="0.05" :format="pct" @update:model-value="store.setHud({ opacity: $event })" />
        </SettingRow>
        <SettingRow label="Size">
          <Slider :model-value="store.settings.hud.scale" :min="0.75" :max="1.75" :step="0.05" :format="pct" @update:model-value="store.setHud({ scale: $event })" />
        </SettingRow>
        <SettingRow label="Position" hint="While this window is open the HUD can be dragged anywhere; it goes back to click-through when you close it.">
          <Button size="sm" @click="bridge().invoke('hud:setEditing', !store.hudEditing)">{{ store.hudEditing ? t('Done') : t('Move HUD') }}</Button>
        </SettingRow>
      </template>
      <SettingRow label="Hide maxed (Lv3) pets" hint="They earn no more souls: left out of the Pets page, Nearby and the HUD.">
        <Toggle :model-value="store.settings.hideMaxed" @update:model-value="store.set('hideMaxed', $event)" />
      </SettingRow>
      <SettingRow label="Black Cloud Merchant pets" hint="When you open one of its tabs, a window lists the pets it sells that you have not maxed: prices, and where they spawn.">
        <Toggle :model-value="store.settings.hud.merchant" @update:model-value="store.setHud({ merchant: $event })" />
      </SettingRow>
    </Section>

    <Section title="Shortcuts" icon="M1.5 4h13v8h-13zM4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6">
      <SettingRow label="Open or hide this window"><kbd class="rounded border border-light bg-dark px-1.5 py-0.5 text-xs">Alt+E</kbd></SettingRow>
      <SettingRow label="Hide or show every overlay"><kbd class="rounded border border-light bg-dark px-1.5 py-0.5 text-xs">Alt+Shift+E</kbd></SettingRow>
    </Section>

    <Section title="Lokthar sync" icon="M13.5 6A5.5 5.5 0 0 0 3 5M2.5 10A5.5 5.5 0 0 0 13 11M3 2v3h3M13 14v-3h-3">
      <SettingRow label="Sync field bosses" hint="Sends the field boss list your map shows (ids, up or dead, times, your server) to the Lokthar timers. Nothing else, and only to the site below.">
        <Toggle :model-value="store.settings.lokthar.sync" @update:model-value="saveLokthar({ sync: $event })" />
      </SettingRow>
      <div class="grid grid-cols-2 gap-3 py-3 text-xs">
        <label class="block">
          <span class="text-darker">{{ t('Site') }}</span>
          <input v-model="siteUrl" class="mt-1 h-8 w-full rounded-md border border-light bg-default px-2.5 text-sm" placeholder="https://lokthar.com" @change="saveLokthar({ url: siteUrl.trim() })" />
        </label>
        <label class="block">
          <span class="text-darker">Token</span>
          <input v-model="token" type="password" autocomplete="off" class="mt-1 h-8 w-full rounded-md border border-light bg-default px-2.5 text-sm" placeholder="lkt_…" @change="saveLokthar({ token: token.trim() })" />
        </label>
      </div>
      <div class="flex items-center justify-between gap-2 py-3 text-xs">
        <span v-if="syncResult" :class="['min-w-0 truncate', syncResult.ok ? 'text-darker' : 'text-red']" :title="syncResult.message">{{ ago(syncResult.at) }}: {{ syncResult.message }}</span>
        <span v-else class="text-darkest">{{ t('Not synced yet') }}</span>
        <div class="flex shrink-0 gap-2">
          <Button size="sm" :disabled="testing" @click="testSync">{{ testing ? t('Testing…') : t('Test') }}</Button>
          <Button size="sm" :disabled="syncing || !token.trim()" :title="t('Send the field bosses as your map last listed them')" @click="syncNow">{{ syncing ? t('Syncing…') : t('Sync now') }}</Button>
        </div>
      </div>
    </Section>

    <Section title="Developer" icon="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13">
      <SettingRow
        label="Packet log"
        hint="Writes every game message to a text file (time, message type, bytes) to share for debugging or to find data for new features. Add marks as you do things in game to find their messages by time. Alt+Shift+R starts and stops it from the game. It grows fast in fights: keep it short."
      >
        <Button size="sm" :intent="packetLog.on ? 'primary' : undefined" @click="bridge().invoke('packets:set', !packetLog.on)">
          {{ packetLog.on ? t('Stop') : t('Start') }}
        </Button>
      </SettingRow>
      <div v-if="packetLog.on" class="flex items-center gap-2 py-3 text-xs">
        <span class="size-2 shrink-0 animate-pulse rounded-full bg-danger" />
        <span class="shrink-0 text-darker">{{ t('Recording') }}{{ packetLog.marks ? ` · ${plural(packetLog.marks, '{n} mark', '{n} marks')}` : '' }}</span>
        <input
          v-model="markText"
          class="h-8 min-w-0 flex-1 rounded-md border border-light bg-default px-2.5 text-sm placeholder:text-darkest"
          :placeholder="t('What you did, e.g. opened the map (Alt+Shift+M marks from the game)')"
          @keydown.enter="addMark"
        />
        <Button size="sm" @click="addMark">{{ t('Mark') }}</Button>
      </div>
      <div v-else-if="packetLog.path" class="flex items-center justify-between gap-2 py-3 text-xs">
        <span class="min-w-0 truncate text-darker" :title="packetLog.path">{{ t('Last: {file} · {n} messages', { file: fileName(packetLog.path), n: packetLog.count.toLocaleString('en-US') }) }}</span>
        <Button size="sm" @click="bridge().invoke('packets:show')">{{ t('Show in folder') }}</Button>
      </div>
    </Section>

    <Section title="Engine" icon="M5.5 1.5v2M10.5 1.5v2M5.5 12.5v2M10.5 12.5v2M1.5 5.5h2M1.5 10.5h2M12.5 5.5h2M12.5 10.5h2M3.5 3.5h9v9h-9zM6 6h4v4H6z">
      <SettingRow label="State" :hint="store.status?.detail ?? t('Last game packet: {when}', { when: lastPacket })" :warning="store.status?.state === 'error' ? 'The game\'s traffic is not being read.' : undefined">
        <span class="flex items-center gap-2 text-sm text-dark"><StatusDot :status="store.status" />{{ t(statusText(store.status)) }}</span>
      </SettingRow>
      <SettingRow label="Collection file" hint="Your pets' souls and levels, kept on this computer.">
        <Button v-if="store.status?.dataFile" size="sm" @click="bridge().invoke('app:openPath', store.status.dataFile)">{{ t('Show in folder') }}</Button>
      </SettingRow>
      <SettingRow label="Restart the engine" hint="If the overlays stop updating.">
        <Button size="sm" @click="bridge().invoke('tracker:restart')">{{ t('Restart') }}</Button>
      </SettingRow>
    </Section>

    <section class="flex items-center justify-between pb-4 text-xs text-darkest">
      <span>{{ t('Version {v}', { v: info?.version ?? '…' }) }}</span>
      <div class="flex gap-3">
        <button v-if="info" type="button" class="hover:text-default" @click="bridge().invoke('app:openPath', info.logFile)">{{ t('Show log') }}</button>
        <button v-if="info" type="button" class="hover:text-default" @click="bridge().invoke('app:openPath', info.settingsFile)">{{ t('Settings file') }}</button>
        <button type="button" class="text-red hover:underline" @click="bridge().invoke('app:quit')">{{ t('Quit') }}</button>
      </div>
    </section>
  </div>
</template>
