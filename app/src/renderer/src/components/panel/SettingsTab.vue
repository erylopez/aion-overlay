<script setup lang="ts">
// HUD, panel, privacy, Lokthar sync and tracker settings. Every change applies at once.
import { onMounted, ref } from 'vue'
import Button from '@/components/Button.vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import { bridge } from '@/lib/bridge.ts'
import { useApp } from '@/stores/app.ts'
import type { SyncResult } from '@shared/lokthar.ts'

const store = useApp()
const info = ref<{ version: string; settingsFile: string; logFile: string } | null>(null)
onMounted(async () => (info.value = await bridge().invoke('app:info')))

const pct = (v: number): string => `${Math.round(v * 100)}%`

const python = ref(store.settings.tracker.python)
const savePython = (): Promise<void> => store.set('tracker', { ...store.settings.tracker, python: python.value.trim() })

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
const ago = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="space-y-4 p-3">
    <section>
      <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-darkest">You</h3>
      <div class="divide-y divide-[color:var(--gray-4)] rounded-lg border border-card bg-card px-3">
        <SettingRow label="Your side" hint="Its zones are listed first where a soul drops.">
          <select
            :value="store.settings.faction"
            class="h-7 rounded-md border border-light bg-default px-2 text-sm"
            @change="store.set('faction', ($event.target as HTMLSelectElement).value as 'elyos' | 'asmodians')"
          >
            <option value="elyos">Elyos</option>
            <option value="asmodians">Asmodian</option>
          </select>
        </SettingRow>
        <SettingRow label="Hide maxed (Lv3) pets" hint="They earn no more souls: left out of the collection, Nearby and the HUD.">
          <Toggle :model-value="store.settings.hideMaxed" @update:model-value="store.set('hideMaxed', $event)" />
        </SettingRow>
        <SettingRow label="Your level" hint="Marks the monsters close enough to it for souls to drop well.">
          <input
            :value="store.settings.playerLevel ?? ''"
            inputmode="numeric"
            placeholder="?"
            class="h-7 w-14 rounded-md border border-light bg-default px-2 text-center text-sm tabular-nums"
            @change="store.set('playerLevel', ($event.target as HTMLInputElement).value.trim() ? Number(($event.target as HTMLInputElement).value) : null)"
          />
        </SettingRow>
      </div>
    </section>

    <section>
      <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-darkest">In-game HUD</h3>
      <div class="divide-y divide-[color:var(--gray-4)] rounded-lg border border-card bg-card px-3">
        <SettingRow label="Show the HUD" hint="Works over borderless or windowed mode, not exclusive fullscreen.">
          <Toggle :model-value="store.settings.hud.enabled" @update:model-value="store.setHud({ enabled: $event })" />
        </SettingRow>
        <SettingRow label="Nearby section" hint="At the top: the soul monsters around you, with the pet each drops.">
          <Toggle :model-value="store.settings.hud.nearby" @update:model-value="store.setHud({ nearby: $event })" />
        </SettingRow>
        <SettingRow v-if="store.settings.hud.nearby" label="How many nearby">
          <Slider :model-value="store.settings.hud.nearbyCount" :min="1" :max="8" :step="1" @update:model-value="store.setHud({ nearbyCount: $event })" />
        </SettingRow>
        <SettingRow
          label="Below it"
          :hint="{ pinned: 'Pin pets in the Collection tab.', recent: 'Pets you gained souls for, latest first.' }[store.settings.hud.mode]"
        >
          <select
            :value="store.settings.hud.mode"
            class="h-7 rounded-md border border-light bg-default px-2 text-sm"
            @change="store.setHud({ mode: ($event.target as HTMLSelectElement).value as 'recent' | 'pinned' })"
          >
            <option value="recent">This session's pets</option>
            <option value="pinned">Pinned pets</option>
          </select>
        </SettingRow>
        <SettingRow v-if="store.settings.hud.mode !== 'pinned'" label="How many this session">
          <Slider :model-value="store.settings.hud.recentCount" :min="1" :max="8" :step="1" @update:model-value="store.setHud({ recentCount: $event })" />
        </SettingRow>
        <SettingRow label="Soul pop-ups" hint="A line for each soul as it drops.">
          <Toggle :model-value="store.settings.hud.toasts" @update:model-value="store.setHud({ toasts: $event })" />
        </SettingRow>
        <SettingRow label="Hide without game traffic" hint="When the game has sent nothing for 15 seconds.">
          <Toggle :model-value="store.settings.hud.hideWithoutGame" @update:model-value="store.setHud({ hideWithoutGame: $event })" />
        </SettingRow>
        <SettingRow label="Kina per hour" hint="This session's Kina per hour, at the top right of the HUD.">
          <Toggle :model-value="store.settings.hud.kina" @update:model-value="store.setHud({ kina: $event })" />
        </SettingRow>
        <SettingRow label="Black Cloud Merchant pets" hint="When you open one of its tabs, a window lists the pets it sells that you have not maxed: prices, and where they spawn. Its X closes it.">
          <Toggle :model-value="store.settings.hud.merchant" @update:model-value="store.setHud({ merchant: $event })" />
        </SettingRow>
        <SettingRow label="Clear between fights" hint="After this long with no kills or drops the HUD clears and hides until the next fight.">
          <Slider
            :model-value="store.settings.hud.idleHideSeconds"
            :min="0"
            :max="300"
            :step="15"
            :format="(v: number) => (v ? `${v}s` : 'Off')"
            @update:model-value="store.setHud({ idleHideSeconds: $event })"
          />
        </SettingRow>
        <SettingRow label="Opacity">
          <Slider :model-value="store.settings.hud.opacity" :min="0.3" :max="1" :step="0.05" :format="pct" @update:model-value="store.setHud({ opacity: $event })" />
        </SettingRow>
        <SettingRow label="Size">
          <Slider :model-value="store.settings.hud.scale" :min="0.75" :max="1.75" :step="0.05" :format="pct" @update:model-value="store.setHud({ scale: $event })" />
        </SettingRow>
        <SettingRow label="Position" hint="While this panel is open the HUD can be dragged anywhere; it goes back to click-through when you close the panel.">
          <Button size="sm" @click="bridge().invoke('hud:setEditing', !store.hudEditing)">
            {{ store.hudEditing ? 'Done' : 'Move HUD' }}
          </Button>
        </SettingRow>
      </div>
    </section>

    <section>
      <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-darkest">Windows</h3>
      <div class="divide-y divide-[color:var(--gray-4)] rounded-lg border border-card bg-card px-3">
        <SettingRow
          label="Sleep while Aion 2 is closed"
          hint="No bubble, HUD or capture until the game starts: only the tray icon, which still opens this panel."
        >
          <Toggle :model-value="store.settings.sleepWithoutGame" @update:model-value="store.set('sleepWithoutGame', $event)" />
        </SettingRow>
        <SettingRow label="Keep this panel on top" hint="Stays above the game while open.">
          <Toggle :model-value="store.settings.panelOnTop" @update:model-value="store.set('panelOnTop', $event)" />
        </SettingRow>
        <SettingRow label="Hide from screen recordings" hint="Keeps the bubble, panel and HUD out of OBS, Discord and screenshots.">
          <Toggle :model-value="store.settings.hideFromCapture" @update:model-value="store.set('hideFromCapture', $event)" />
        </SettingRow>
      </div>
    </section>

    <section>
      <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-darkest">Lokthar sync</h3>
      <div class="divide-y divide-[color:var(--gray-4)] rounded-lg border border-card bg-card px-3">
        <SettingRow
          label="Sync field bosses"
          hint="Sends the field boss list your map shows (ids, up or dead, times, your server) to the Lokthar timers. Nothing else, and only to the site below."
        >
          <Toggle :model-value="store.settings.lokthar.sync" @update:model-value="saveLokthar({ sync: $event })" />
        </SettingRow>
        <div class="space-y-2 py-2 text-xs">
          <label class="block">
            <span class="text-darker">Site</span>
            <input
              v-model="siteUrl"
              class="mt-1 h-7 w-full rounded-md border border-light bg-default px-2 text-xs"
              placeholder="https://lokthar.com"
              @change="saveLokthar({ url: siteUrl.trim() })"
            />
          </label>
          <label class="block">
            <span class="text-darker">Token</span>
            <input
              v-model="token"
              type="password"
              autocomplete="off"
              class="mt-1 h-7 w-full rounded-md border border-light bg-default px-2 text-xs"
              placeholder="lkt_…"
              @change="saveLokthar({ token: token.trim() })"
            />
          </label>
          <div class="flex items-center justify-between gap-2 pt-1">
            <span v-if="syncResult" :class="['min-w-0 truncate', syncResult.ok ? 'text-darker' : 'text-red']" :title="syncResult.message">
              {{ ago(syncResult.at) }}: {{ syncResult.message }}
            </span>
            <span v-else class="text-darkest">Not synced yet</span>
            <Button size="sm" :disabled="testing" @click="testSync">{{ testing ? 'Testing…' : 'Test' }}</Button>
          </div>
        </div>
      </div>
    </section>

    <section>
      <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-darkest">Tracker</h3>
      <div class="space-y-2 rounded-lg border border-card bg-card p-3 text-xs">
        <div class="flex items-center justify-between gap-2">
          <span class="text-darker">Collection file</span>
          <button
            v-if="store.status?.dataFile"
            type="button"
            class="truncate text-accent hover:underline"
            :title="store.status.dataFile"
            @click="bridge().invoke('app:openPath', store.status.dataFile)"
          >
            Show in folder
          </button>
        </div>
        <label class="block">
          <span class="text-darker">Python</span>
          <input
            v-model="python"
            class="mt-1 h-7 w-full rounded-md border border-light bg-default px-2 text-xs"
            placeholder="C:\…\python.exe"
            @change="savePython"
          />
        </label>
        <div class="flex justify-end pt-1">
          <Button size="sm" @click="bridge().invoke('tracker:restart')">Restart tracker</Button>
        </div>
      </div>
    </section>

    <section class="flex items-center justify-between text-xs text-darkest">
      <span>Version {{ info?.version ?? '…' }}</span>
      <div class="flex gap-3">
        <button v-if="info" type="button" class="hover:text-default" @click="bridge().invoke('app:openPath', info.logFile)">Show log</button>
        <button v-if="info" type="button" class="hover:text-default" @click="bridge().invoke('app:openPath', info.settingsFile)">Settings file</button>
        <button type="button" class="text-red hover:underline" @click="bridge().invoke('app:quit')">Quit</button>
      </div>
    </section>
  </div>
</template>
