<script setup lang="ts">
// Since the tracker started: souls per pet, and what the tracker sees of the game.
import { computed, ref } from 'vue'
import GenusPill from '@/components/GenusPill.vue'
import LevelBadge from '@/components/LevelBadge.vue'
import PetIcon from '@/components/PetIcon.vue'
import Sparkline from '@/components/Sparkline.vue'
import StatusDot, { statusText } from '@/components/StatusDot.vue'
import { bridge } from '@/lib/bridge.ts'
import { displayName } from '@/lib/petDb.ts'
import { formatKina } from '@shared/kina.ts'
import { useApp } from '@/stores/app.ts'

const store = useApp()
const gained = computed(() => store.pets.filter((p) => p.session > 0).sort((a, b) => b.session - a.session))
/** Reset asks once: the first click arms it for 3 seconds, the second resets. */
const confirming = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null
function resetSession(): void {
  if (confirmTimer) clearTimeout(confirmTimer)
  if (!confirming.value) {
    confirming.value = true
    confirmTimer = setTimeout(() => (confirming.value = false), 3000)
    return
  }
  confirming.value = false
  void bridge().invoke('tracker:resetSession')
}
/** "14:32 · 48.2k/h": a point of the timeline, on hover. */
const kinaPointLabel = (i: number): string => {
  const p = store.kinaTimeline[i]
  if (!p) return ''
  const at = new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${at} · ${formatKina(p.perHour)}/h`
}
const lastPacket = computed(() => {
  const ago = store.status?.lastPacketAgo
  return ago === null || ago === undefined ? 'never' : ago < 5 ? 'just now' : `${Math.round(ago)} s ago`
})
</script>

<template>
  <div class="space-y-3 p-3">
    <div class="flex items-center justify-between text-xs">
      <span class="font-medium text-darker">This session</span>
      <button
        type="button"
        :class="[
          'rounded-md border px-2 py-0.5 transition',
          confirming ? 'border-danger/50 bg-danger/10 text-danger' : 'border-light text-darker hover:text-dark',
        ]"
        title="Start the session's souls and Kina again (your collection is not changed)"
        @click="resetSession"
      >
        {{ confirming ? 'Click again to reset' : 'Reset session' }}
      </button>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div class="rounded-lg bg-card p-3 text-center">
        <div class="text-3xl font-semibold tabular-nums text-accent">{{ store.sessionSouls }}</div>
        <div class="text-xs text-darker">souls this session, across {{ gained.length }} pet{{ gained.length === 1 ? '' : 's' }}</div>
      </div>
      <div class="rounded-lg bg-card p-3 text-center">
        <div
          v-if="store.kinaRate !== null"
          title="Kina earned per hour of farming: gains only (spending is not taken off), and a break of more than 5 minutes counts as 5."
          class="text-3xl font-semibold tabular-nums text-yellow">{{ formatKina(store.kinaRate) }}</div>
        <!-- Kina is coming in, but under a minute of it: no rate yet. -->
        <div v-else-if="store.kina.earned" class="flex h-9 items-center justify-center text-lg font-semibold text-yellow">measuring…</div>
        <div v-else class="text-3xl font-semibold text-yellow">—</div>
        <div class="text-xs text-darker">
          <template v-if="store.kina.earned">Kina per hour, {{ formatKina(store.kina.earned) }} earned</template>
          <template v-else>Kina per hour, from your first loot</template>
        </div>
        <Sparkline
          v-if="store.kinaTimeline.length"
          :values="store.kinaTimeline.map((p) => p.perHour)"
          :label="kinaPointLabel"
          class="mt-2 h-8 text-yellow"
        />
      </div>
    </div>

    <ul v-if="gained.length" class="divide-y divide-[color:var(--gray-4)] rounded-lg border border-card bg-card">
      <li
        v-for="pet in gained"
        :key="pet.id"
        class="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition hover:bg-dark"
        title="Show where its souls drop"
        @click="store.openPet(pet.id)"
      >
        <PetIcon :id="pet.id" :size="28" />
        <span class="flex min-w-0 flex-1 items-center gap-1.5">
          <span class="truncate">{{ displayName(pet) }}</span>
          <GenusPill :id="pet.id" />
        </span>
        <span class="tabular-nums text-green">+{{ pet.session }}</span>
        <span class="w-10 text-right font-semibold tabular-nums">{{ pet.souls }}</span>
        <LevelBadge :pet="pet" />
      </li>
    </ul>
    <p v-else class="py-4 text-center text-sm text-darker">No souls yet this session.</p>

    <div class="space-y-1.5 rounded-lg border border-card p-3 text-xs">
      <div class="flex items-center gap-2 font-medium">
        <StatusDot :status="store.status" /> {{ statusText(store.status) }}
      </div>
      <div v-if="store.status?.detail" class="break-words text-darker">{{ store.status.detail }}</div>
      <div class="text-darker">Last game packet: {{ lastPacket }}</div>
      <div v-if="store.status?.replay" class="text-yellow">Replaying a saved capture (A2T_REPLAY): counts are not saved.</div>
    </div>
  </div>
</template>
