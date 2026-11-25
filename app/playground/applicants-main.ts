import './slowmo.ts'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@/assets/main.css'
import ApplicantsPage from '@/pages/ApplicantsPage.vue'
import { useApp } from '@/stores/app.ts'
import { installStub, setSetting, getSettings, sim } from './stub.ts'

// The join requests widget: http://localhost:5199/applicants.html  (?n=3 starts with 3 requests)
installStub()
const params = new URLSearchParams(location.search)
const set = (patch: Record<string, unknown>): void => setSetting('applicants', { ...getSettings().applicants, enabled: true, ...patch })
set({})
const pinia = createPinia()
createApp(ApplicantsPage).use(pinia).mount('#playground')
void useApp(pinia).init().then(() => {
  for (let i = 0; i < Number(params.get('n') ?? 0); i++) sim.apply()
})

// For the recorder (record-applicants.mjs): ?bare=1 shows the widget alone over the game, no buttons.
;(window as unknown as { promo: unknown }).promo = { sim }
const box = document.getElementById('controls')!
if (params.has('bare')) {
  box.remove()
  const stage = document.getElementById('playground')!.parentElement!
  stage.style.cssText += ';justify-content: flex-start; padding: 0; align-items: flex-start'
}
const button = (label: string, run: () => void): void => {
  const b = document.createElement('button')
  b.textContent = label
  b.style.cssText = 'padding: 6px 10px; background: #2a3336; color: #ddd; border: 1px solid #455; border-radius: 6px; cursor: pointer'
  b.onclick = run
  box.append(b)
}
button('Someone applies', () => sim.apply())
button('Clear the list', () => sim.noApplicants())
button('Minimized: toggle', () => set({ collapsed: !getSettings().applicants.collapsed }))
button('Opacity 50%', () => set({ opacity: 0.5 }))
button('Opacity 100%', () => set({ opacity: 1 }))
button('Hide after 10 s', () => set({ hideAfter: 10 }))
