/**
 * The IPC contract: every channel, its arguments and its result, in one place. Main registers
 * handlers against it, preload builds the bridge from it, the renderer calls the bridge. The
 * pattern is marnis-app's (shared/ipc-contract.ts), with this app's channels.
 */
import type { Point, SettingKey, Settings } from './settings.ts'
import type { Nearby, Pet, ShopStock, SoulToast, TrackerStatus } from './tracker.ts'
import type { UpdateStatus } from './update.ts'

/** Renderer → main, request/response. */
export interface InvokeChannels {
  'app:info': { args: []; result: { version: string; settingsFile: string; logFile: string } }
  'app:quit': { args: []; result: void }
  'app:openPath': { args: [path: string]; result: void }

  'settings:all': { args: []; result: Settings }
  'settings:set': { args: [key: SettingKey, value: unknown]; result: void }

  'tracker:get': { args: []; result: { status: TrackerStatus; pets: Pet[]; nearby: Nearby; shop: ShopStock[] } }
  'tracker:setSouls': { args: [pet: number, souls: number]; result: void }
  'tracker:setName': { args: [pet: number, name: string]; result: void }
  'tracker:restart': { args: []; result: void }

  'update:get': { args: []; result: UpdateStatus }
  'update:check': { args: []; result: void }
  'update:download': { args: []; result: void }
  'update:install': { args: []; result: void }

  'bubble:moveTo': { args: [to: Point]; result: void }
  'bubble:dragEnd': { args: []; result: void }
  'panel:toggle': { args: []; result: void }
  'panel:hide': { args: []; result: void }
  'panel:setExpanded': { args: [expanded: boolean]; result: void }

  'hud:setEditing': { args: [editing: boolean]; result: void }
  'hud:moveTo': { args: [to: Point]; result: void }
  'hud:dragEnd': { args: []; result: void }
  'hud:resize': { args: [size: { width: number; height: number }]; result: void }
  'merchant:moveTo': { args: [to: Point]; result: void }
  'merchant:dragEnd': { args: []; result: void }
  'merchant:resize': { args: [size: { width: number; height: number }]; result: void }
  'merchant:close': { args: []; result: void }
}

/** Main → renderer, broadcast. */
export interface EventChannels {
  'settings:changed': Settings
  'tracker:status': TrackerStatus
  'tracker:pets': Pet[]
  'tracker:pet': Pet
  'tracker:soul': SoulToast
  'tracker:nearby': Nearby
  /** You killed something (at most every 5 s): keeps the HUD up between souls. */
  'tracker:combat': number
  /** The merchant's stock: the latest of each tab opened, until its restock. */
  'tracker:shop': ShopStock[]
  'hud:editing': boolean
  'panel:visible': boolean
  'update:status': UpdateStatus
}

export type InvokeChannel = keyof InvokeChannels
export type EventChannel = keyof EventChannels
export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['args']
export type InvokeResult<C extends InvokeChannel> = InvokeChannels[C]['result']
export type EventPayload<C extends EventChannel> = EventChannels[C]

/** What preload exposes as `window.a2t`. */
export interface Bridge {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void
}

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  'app:info', 'app:quit', 'app:openPath',
  'settings:all', 'settings:set',
  'tracker:get', 'tracker:setSouls', 'tracker:setName', 'tracker:restart',
  'update:get', 'update:check', 'update:download', 'update:install',
  'bubble:moveTo', 'bubble:dragEnd', 'panel:toggle', 'panel:hide', 'panel:setExpanded',
  'hud:setEditing', 'hud:moveTo', 'hud:dragEnd', 'hud:resize',
  'merchant:moveTo', 'merchant:dragEnd', 'merchant:resize', 'merchant:close',
]

export const EVENT_CHANNELS: readonly EventChannel[] = [
  'settings:changed', 'tracker:status', 'tracker:pets', 'tracker:pet', 'tracker:soul', 'tracker:nearby', 'tracker:combat', 'tracker:shop', 'hud:editing', 'panel:visible', 'update:status',
]
