/**
 * Persisted settings: `%APPDATA%\Lokthar\settings.json`.
 *
 * As in marnis-app: the store is created on first use, never at import, because electron-store
 * fixes the `userData` path when it is constructed. And every write is normalised, then broadcast
 * to every window so all three stay in step.
 */
import ElectronStore from 'electron-store'
import { normalise, SETTINGS_DEFAULTS, type SettingKey, type Settings } from '../shared/settings.ts'

// electron-store is ESM-only and the main bundle is CommonJS: the class sits on `.default`.
const Store = ((ElectronStore as unknown as { default?: typeof ElectronStore }).default ??
  ElectronStore) as typeof ElectronStore

let store: ElectronStore<Settings> | null = null
const listeners = new Set<(all: Settings, key: SettingKey) => void>()

function db(): ElectronStore<Settings> {
  store ??= new Store<Settings>({ name: 'settings', defaults: SETTINGS_DEFAULTS })
  return store
}

export const settings = {
  get<K extends SettingKey>(key: K): Settings[K] {
    return normalise(key, db().get(key))
  },
  set<K extends SettingKey>(key: K, value: unknown): void {
    db().set(key, normalise(key, value))
    const all = this.all()
    for (const fn of listeners) fn(all, key)
  },
  all(): Settings {
    const out = {} as Record<SettingKey, unknown>
    for (const key of Object.keys(SETTINGS_DEFAULTS) as SettingKey[]) out[key] = this.get(key)
    return out as unknown as Settings
  },
  onChanged(fn: (all: Settings, key: SettingKey) => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get path(): string {
    return db().path
  },
}
