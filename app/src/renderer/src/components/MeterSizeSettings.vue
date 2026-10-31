<script setup lang="ts">
// The DPS meter overlay's size and idle hiding, the same rows on the Combat Meter page and in
// Settings. The size is set by dragging the meter's bottom-right corner: here it is shown and reset.
import { computed } from 'vue'
import Button from '@/components/Button.vue'
import SettingRow from '@/components/SettingRow.vue'
import Slider from '@/components/Slider.vue'
import Toggle from '@/components/Toggle.vue'
import { t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import { SETTINGS_DEFAULTS, type Settings } from '@shared/settings.ts'

const store = useApp()
const cfg = computed(() => store.settings.meter)
const set = (patch: Partial<Settings['meter']>): void => void store.set('meter', { ...cfg.value, ...patch })
const defaultSize = computed(() => cfg.value.width === SETTINGS_DEFAULTS.meter.width && cfg.value.height === null)
</script>

<template>
  <SettingRow label="Size" hint="Drag the meter's bottom-right corner to resize it; a double-click there resets it.">
    <div class="flex items-center gap-3">
      <span class="text-sm tabular-nums text-dark">{{ cfg.width }} × {{ cfg.height ?? t('fits its rows') }}</span>
      <Button size="sm" :disabled="defaultSize" @click="set({ width: SETTINGS_DEFAULTS.meter.width, height: null })">{{ t('Reset') }}</Button>
    </div>
  </SettingRow>
  <SettingRow label="Hide while idle" hint="Hides the meter when no damage has come in for a while; it comes back with the next hit.">
    <Toggle :model-value="cfg.hideIdle" @update:model-value="set({ hideIdle: $event })" />
  </SettingRow>
  <SettingRow v-if="cfg.hideIdle" label="Hide after">
    <Slider :model-value="cfg.idleSeconds" :min="5" :max="120" :step="5" :format="(v: number) => `${v}s`" @update:model-value="set({ idleSeconds: $event })" />
  </SettingRow>
</template>
