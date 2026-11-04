<script setup lang="ts">
// Guild Events: the Lokthar site's events that ask the roster who comes (shared/guildEvents.ts),
// answered here or from the popup over the game. Needs attention: the ones still to answer, with
// their buttons; Coming up: the rest, with your answer. An event opens to who comes: going first,
// then maybe, each with their main's class, gear score and combat power; then who doesn't.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from '@/components/Button.vue'
import ClassIcon from '@/components/ClassIcon.vue'
import SettingRow from '@/components/SettingRow.vue'
import Toggle from '@/components/Toggle.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Section from '@/components/ui/Section.vue'
import { bridge } from '@/lib/bridge.ts'
import { closesIn, RSVP_CLASS, RSVP_LABEL } from '@/lib/guildEvents.ts'
import { loc, t } from '@/lib/i18n.ts'
import { useApp } from '@/stores/app.ts'
import { needsAnswer, RSVPS, type GuildEvent, type GuildEventDetail, type Rsvp } from '@shared/guildEvents.ts'

const store = useApp()
const api = bridge()
const g = computed(() => store.guildEvents)
const cfg = computed(() => store.settings.guildEvents)
const setCfg = (patch: Partial<typeof cfg.value>): void => void store.set('guildEvents', { ...cfg.value, ...patch })

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 30_000)

const attention = computed(() => g.value.events.filter((e) => needsAnswer(e, now.value)).sort((a, b) => a.closesAt - b.closesAt))
const coming = computed(() => g.value.events.filter((e) => !needsAnswer(e, now.value)))

/** "Fri 23:00". */
const when = (ms: number): string => new Date(ms).toLocaleString(loc(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const clock = (ms: number): string => new Date(ms).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })

const busy = ref<number | null>(null)
const error = ref<{ id: number; message: string } | null>(null)
async function answer(e: GuildEvent, status: Rsvp): Promise<void> {
  busy.value = e.id
  const message = await api.invoke('guildEvents:respond', e.id, status)
  error.value = message ? { id: e.id, message } : null
  busy.value = null
  if (open.value?.event.id === e.id) void load(e.id)
}

// One event open: who comes.
const open = ref<GuildEventDetail | null>(null)
const opening = ref(false)
async function load(id: number): Promise<void> {
  const detail = await api.invoke('guildEvents:detail', id)
  if (detail) open.value = detail
}
async function show(e: GuildEvent): Promise<void> {
  opening.value = true
  open.value = { event: e, responses: [] }
  await load(e.id)
  opening.value = false
}
const by = (status: Rsvp) => computed(() => open.value?.responses.filter((r) => r.status === status) ?? [])
const going = by('going')
const maybe = by('maybe')
const declined = by('declined')
// Someone answered, or the event changed: the one open is asked again.
let off: (() => void) | null = null
onMounted(() => (off = api.on('guildEvents:changed', (id) => open.value?.event.id === id && void load(id))))
watch(
  () => g.value.events,
  (list) => {
    const e = open.value && list.find((x) => x.id === open.value!.event.id)
    if (e) open.value = { ...open.value!, event: e }
  },
)
onBeforeUnmount(() => {
  clearInterval(ticker)
  off?.()
})

const STATE_TEXT: Record<string, string> = {
  waiting: 'Log in to the game once: the site knows you by your characters.',
  loading: 'Asking the site…',
  notMember: 'None of your characters is on the Aion roster at the Lokthar site. Your main there has to be one the app has seen (Characters page).',
}
const n = (v: number | null): string => (v === null ? '—' : v.toLocaleString(loc()))
</script>

<template>
  <div>
    <PageHeader title="Guild Events" about="The guild's events that ask who is coming, from the Lokthar site. Answer here or from the popup over the game; open an event to see who comes.">
      <Button v-if="cfg.enabled" size="sm" :title="t('Ask the site again now')" @click="api.invoke('guildEvents:refresh')">{{ t('Refresh') }}</Button>
    </PageHeader>

    <Section title="Settings">
      <SettingRow label="Guild events" hint="Asks the Lokthar site for the events, sending your characters' names and servers so it knows who you are.">
        <Toggle :model-value="cfg.enabled" @update:model-value="setCfg({ enabled: $event })" />
      </SettingRow>
      <SettingRow v-if="cfg.enabled" label="Pop up over the game" hint="An event to answer pops up in the bottom right corner of the game's screen.">
        <Toggle :model-value="cfg.popup" @update:model-value="setCfg({ popup: $event })" />
      </SettingRow>
    </Section>

    <template v-if="cfg.enabled">
      <div class="mb-4 flex items-center gap-2 text-xs text-darker">
        <span :class="['size-1.5 rounded-full', g.state === 'ok' ? (g.live ? 'bg-green' : 'bg-yellow') : g.state === 'error' || g.state === 'notMember' ? 'bg-red' : 'bg-darker']" />
        <template v-if="g.state === 'ok' && g.member">
          <span class="font-medium text-default">{{ [g.member.name, g.member.roster].filter(Boolean).join(' · ') }}</span>
          <span>· {{ g.live ? t('live') : t('checking every minute') }}</span>
        </template>
        <span v-else-if="g.state === 'error'" class="text-danger">{{ g.message }}</span>
        <span v-else>{{ t(STATE_TEXT[g.state] ?? '') }}</span>
      </div>

      <!-- One event: who comes. -->
      <div v-if="open">
        <button type="button" class="mb-4 flex items-center gap-1 text-sm text-darker hover:text-default" @click="open = null">
          <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
          {{ t('All events') }}
        </button>
        <div class="mb-6 rounded-xl border border-card bg-card p-5">
          <div class="flex flex-wrap items-start gap-4">
            <div class="min-w-0 flex-1">
              <div class="text-xs font-semibold uppercase tracking-wide" :style="{ color: open.event.color }">{{ open.event.activityLabel }} · {{ open.event.roster }}</div>
              <h2 class="mt-1 text-xl font-bold">{{ open.event.name }}</h2>
              <p class="mt-1 text-sm text-darker">{{ when(open.event.startsAt) }} – {{ clock(open.event.endsAt) }} · {{ closesIn(open.event.closesAt, now) }}</p>
              <p v-if="open.event.description" class="mt-3 whitespace-pre-line text-sm text-dark">{{ open.event.description }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span v-if="open.event.status" :class="['rounded-full px-2.5 py-0.5 text-xs font-semibold', RSVP_CLASS[open.event.status]]">{{ t(RSVP_LABEL[open.event.status]) }}</span>
            </div>
          </div>
          <div v-if="open.event.open" class="mt-4 flex flex-wrap items-center gap-2 border-t border-card pt-4">
            <span class="mr-1 text-xs text-darker">{{ t('Your answer') }}</span>
            <button
              v-for="s in RSVPS"
              :key="s"
              type="button"
              :disabled="busy === open.event.id"
              :class="['rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-60', open.event.status === s ? 'bg-accent text-white' : 'bg-dark text-default hover:bg-light']"
              @click="answer(open.event, s)"
            >
              {{ t(s === 'going' ? 'Sign up' : s === 'maybe' ? 'Maybe' : 'Decline') }}
            </button>
            <span v-if="error?.id === open.event.id" class="text-xs text-danger">{{ error.message }}</span>
          </div>
        </div>

        <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div v-for="[label, value, cls] in ([['Going', open.event.counts.going, 'text-green'], ['Maybe', open.event.counts.maybe, 'text-yellow'], ['Not going', open.event.counts.declined, 'text-red'], ['No answer yet', open.event.unanswered, 'text-darker']] as const)" :key="label" class="rounded-xl border border-card bg-card px-4 py-3">
            <div :class="['text-2xl font-bold tabular-nums', cls]">{{ value }}</div>
            <div class="text-xs text-darker">{{ t(label) }}</div>
          </div>
        </div>

        <p v-if="opening && !open.responses.length" class="text-sm text-darker">{{ t('Loading…') }}</p>
        <template v-for="[title, list] in ([['Going', going], ['Maybe', maybe]] as const)" :key="title">
          <Section v-if="list.length" :title="title" bare>
            <div class="overflow-hidden rounded-xl border border-card">
              <table class="w-full text-sm">
                <thead class="bg-card text-xs uppercase tracking-wide text-darker">
                  <tr class="border-b border-card">
                    <th class="py-2 pl-4 text-left font-medium">{{ t('Player') }}</th>
                    <th class="w-28 px-3 text-right font-medium" :title="t('Gear score')">GS</th>
                    <th class="w-32 px-3 text-right font-medium" :title="t('Combat power')">CP</th>
                    <th class="w-36 pr-4 text-right font-medium">{{ t('Answered') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[color:var(--line)]">
                  <tr v-for="r in list" :key="r.name" class="hover:bg-card">
                    <td class="py-2 pl-4">
                      <div class="flex items-center gap-2.5">
                        <ClassIcon :class-name="r.className" :size="20" />
                        <span class="font-medium">{{ r.name }}</span>
                        <span v-if="r.className" class="text-xs capitalize text-darker">{{ r.className }}</span>
                      </div>
                    </td>
                    <td class="px-3 text-right tabular-nums">{{ n(r.gearScore) }}</td>
                    <td class="px-3 text-right tabular-nums">{{ n(r.combatPower) }}</td>
                    <td class="pr-4 text-right text-xs text-darker">{{ when(r.answeredAt) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>
        </template>
        <Section v-if="declined.length" title="Not going" bare>
          <p class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-darker">
            <span v-for="r in declined" :key="r.name" class="flex items-center gap-1.5"><ClassIcon :class-name="r.className" :size="16" />{{ r.name }}</span>
          </p>
        </Section>
      </div>

      <!-- The events. -->
      <template v-else-if="g.state === 'ok'">
        <p v-if="!g.events.length" class="rounded-xl border border-card bg-card px-4 py-8 text-center text-sm text-darker">{{ t('No events asking for attendance right now.') }}</p>
        <template v-for="[title, list] in ([['Needs attention', attention], ['Coming up', coming]] as const)" :key="title">
          <Section v-if="list.length" :title="title" bare>
            <div class="divide-y divide-[color:var(--line)] overflow-hidden rounded-xl border border-card bg-card">
              <div v-for="e in list" :key="e.id" class="px-4 py-3.5">
                <button type="button" class="group flex w-full items-center gap-4 text-left" @click="show(e)">
                  <span class="grid size-11 shrink-0 place-items-center rounded-xl" :style="{ background: `${e.color}26`, color: e.color }">
                    <svg viewBox="0 0 16 16" class="size-5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
                    </svg>
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="flex flex-wrap items-center gap-2 text-xs text-darker">
                      {{ when(e.startsAt) }}
                      <span v-if="needsAnswer(e, now)" class="rounded-full bg-accent/15 px-2 py-0.5 font-semibold text-accent">{{ t('Respond') }}</span>
                      <span v-else-if="e.status" :class="['rounded-full px-2 py-0.5 font-semibold', RSVP_CLASS[e.status]]">{{ t(RSVP_LABEL[e.status]) }}</span>
                      <span v-else class="rounded-full bg-dark px-2 py-0.5 font-semibold text-darker">{{ t('Closed') }}</span>
                    </span>
                    <span class="mt-0.5 block font-semibold text-default">{{ e.name }}</span>
                    <span class="block text-xs text-darker">
                      {{ e.activityLabel }} · {{ t('{n} going', { n: e.counts.going }) }}<template v-if="e.counts.maybe"> · {{ t('{n} maybe', { n: e.counts.maybe }) }}</template>
                      <template v-if="needsAnswer(e, now)"> · {{ closesIn(e.closesAt, now) }}</template>
                    </span>
                  </span>
                  <svg viewBox="0 0 16 16" class="size-4 shrink-0 text-darker group-hover:text-default" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
                </button>
                <div v-if="needsAnswer(e, now)" class="ml-[60px] mt-3 flex flex-wrap items-center gap-1 rounded-lg border border-card px-2 py-1">
                  <button
                    v-for="s in RSVPS"
                    :key="s"
                    type="button"
                    :disabled="busy === e.id"
                    class="rounded-md px-3 py-1 text-[13px] font-medium text-dark hover:bg-dark hover:text-default disabled:opacity-60"
                    @click="answer(e, s)"
                  >
                    {{ t(s === 'going' ? 'Sign up' : s === 'maybe' ? 'Maybe' : 'Decline') }}
                  </button>
                  <span v-if="error?.id === e.id" class="ml-2 text-xs text-danger">{{ error.message }}</span>
                </div>
              </div>
            </div>
          </Section>
        </template>
      </template>
    </template>
  </div>
</template>
