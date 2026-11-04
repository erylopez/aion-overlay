<script setup lang="ts">
// A guild event to answer (shared/guildEvents.ts), popped up over the game in the bottom right
// corner of its screen: what and when, until when it takes answers, who you are to the site, and
// Sign up / Maybe / Decline. The soonest to close goes first; answered, the next one comes, or
// it goes away. Its X closes it unanswered (it stays on the Guild Events page). Nothing to show
// measures 0, and main keeps the window hidden.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bridge } from '@/lib/bridge.ts'
import { loc, t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import { needsAnswer, toPopUp, type Rsvp } from '@shared/guildEvents.ts'
import { closesIn } from '@/lib/guildEvents.ts'

const store = useApp()
const api = bridge()
const root = ref<HTMLElement | null>(null)

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 15_000)

const event = computed(() => toPopUp(store.guildEvents, now.value))
/** The others waiting for an answer, after this one. */
const more = computed(() => store.guildEvents.events.filter((e) => needsAnswer(e, now.value) && !store.guildEvents.dismissed.includes(e.id)).length - 1)
const when = (ms: number): string => new Date(ms).toLocaleString(loc(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })

const busy = ref(false)
const error = ref<string | null>(null)
watch(() => event.value?.id, () => (error.value = null))

async function answer(status: Rsvp): Promise<void> {
  if (!event.value || busy.value) return
  busy.value = true
  error.value = await api.invoke('guildEvents:respond', event.value.id, status)
  busy.value = false
}
const dismiss = (): void => {
  if (event.value) void api.invoke('guildEvents:dismiss', event.value.id)
}

let sent = ''
function report(): void {
  const el = root.value
  const r = el && event.value ? el.getBoundingClientRect() : { width: 0, height: 0 }
  const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`
  if (key === sent) return
  sent = key
  void api.invoke('eventtoast:resize', { width: r.width, height: r.height })
}
watch([() => event.value?.id, error], () => void nextTick(report))

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(report)
  if (root.value) observer.observe(root.value)
  report()
})
onBeforeUnmount(() => {
  clearInterval(ticker)
  observer?.disconnect()
})
</script>

<template>
  <div class="inline-block">
    <div ref="root" class="inline-block">
      <section v-if="event" class="m-1.5 w-[380px] rounded-xl border border-card bg-darker/95 px-4 py-3.5 shadow-card">
        <div class="flex items-start gap-3">
          <svg viewBox="0 0 16 16" class="mt-0.5 size-5 shrink-0 text-accent" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="12" height="11" rx="1.5" />
            <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3M5 9h.01M8 9h.01M11 9h.01M5 11.5h.01M8 11.5h.01" />
          </svg>
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-2">
              <h1 class="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-default">{{ t('Respond to {name}', { name: event.name }) }}</h1>
              <button
                type="button"
                class="-mr-1.5 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded text-darker hover:bg-dark hover:text-default"
                :title="t('Answer later, from the Guild Events page')"
                @click="dismiss"
              >
                <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
              </button>
            </div>
            <p class="mt-0.5 text-[13px] text-dark">
              <span class="font-medium" :style="{ color: event.color }">{{ event.activityLabel }}</span> · {{ when(event.startsAt) }}.
              {{ closesIn(event.closesAt, now) }}
            </p>
            <p v-if="store.guildEvents.member" class="mt-1.5 text-xs text-darker">
              {{ [store.guildEvents.member.name, store.guildEvents.member.roster].filter(Boolean).join(' · ') }}
              <span v-if="event.counts.going" class="text-darkest"> · {{ t('{n} going', { n: event.counts.going }) }}</span>
            </p>
            <div class="mt-3 flex items-center gap-2">
              <button type="button" :disabled="busy" class="rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-60" @click="answer('going')">
                {{ t('Sign up') }}
              </button>
              <button type="button" :disabled="busy" class="rounded-md bg-dark px-3 py-1.5 text-[13px] font-medium text-default hover:bg-light disabled:opacity-60" @click="answer('maybe')">
                {{ t('Maybe') }}
              </button>
              <button type="button" :disabled="busy" class="rounded-md bg-dark px-3 py-1.5 text-[13px] font-medium text-default hover:bg-light disabled:opacity-60" @click="answer('declined')">
                {{ t('Decline') }}
              </button>
              <span v-if="more > 0" class="ml-auto text-[11px] text-darker">{{ t('+{n} more', { n: more }) }}</span>
            </div>
            <p v-if="error" class="mt-2 text-xs text-danger">{{ error }}</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
