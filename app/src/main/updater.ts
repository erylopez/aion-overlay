/**
 * App updates, only when asked (Settings → Updates → Check for updates), in one go: electron-updater
 * reads the latest release of github.com/erylopez/aion-overlay (the latest.yml the build attaches
 * to it); a newer version is downloaded, put in over this copy, and the app starts again. Opening
 * the Updates page only looks the newest version up (`peek`), for its manual download links; nothing
 * is downloaded unless asked. Its requests go through electron-updater's own session, not the
 * windows' one that main/index.ts blocks.
 *
 * The installed copy runs the new installer silently. The portable copy (the zip, unpacked
 * anywhere) has none: it downloads the release's zip, checks it against the release's SHA-256,
 * unpacks it next to the system's temp files, and on quitting hands over to a small script that
 * waits for the app to close, copies the new files over this folder and starts it again. The data
 * is in %APPDATA%\Lokthar either way, untouched.
 *
 * The exe was renamed in 0.3.7 (Aion2DropTracker.exe -> lokthar-overlay.exe): a zip with either name
 * is taken, its exe is the one started, and the old one is deleted. Copies before 0.3.7 look for
 * their own name only, so they update to 0.3.7 by hand once (the Updates page's zip link).
 */
import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import electronUpdater from 'electron-updater'
import { broadcast } from './broadcast.ts'
import { log } from './tracker.ts'
import { RELEASE_REPO, releaseFile, type UpdateState } from '../shared/update.ts'

// electron-updater is CommonJS: its named exports sit on the default import in the ESM build.
const { autoUpdater } = electronUpdater

/** An installed copy has its uninstaller next to it ("Uninstall Lokthar.exe"); one unpacked from the zip does not. */
function isPortable(): boolean {
  if (process.platform !== 'win32' || !app.isPackaged) return false
  try {
    return !readdirSync(dirname(app.getPath('exe'))).some((f) => /^Uninstall .+\.exe$/i.test(f))
  } catch {
    return false
  }
}
const portable = isPortable()

let state: UpdateState = {
  status: app.isPackaged ? 'idle' : 'dev',
  current: app.getVersion(),
  latest: null,
  releasedAt: null,
  notes: null,
  percent: 0,
  error: null,
  checkedAt: null,
  portable,
}

/** The Updates page looks the newest release up when opened, this often at most. */
const PEEK_EVERY_MS = 10 * 60_000
/** Looked up by itself too (the bubble's "!" badge): a while after the app starts, then every half hour. */
const LOOK_AFTER_MS = 30_000
const LOOK_EVERY_MS = 30 * 60_000
/** Check for updates was clicked: a newer version is downloaded and installed without asking again. */
let andInstall = false
/** The portable copy's update, unpacked and ready: the folder holding the new exe, and its name. */
let portableReady: { dir: string; exe: string } | null = null
/** The exe's names, newest first (electron-builder.yml's executableName). */
const EXE_NAMES = ['lokthar-overlay.exe', 'Aion2DropTracker.exe']

const run = promisify(execFile)

/** The release's zip, downloaded with progress, checked against its `.sha256`, unpacked. */
async function downloadPortable(version: string): Promise<{ dir: string; exe: string }> {
  const name = `Lokthar-${version}-portable.zip`
  const dir = join(app.getPath('temp'), `lokthar-update-${version}`)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const zip = join(dir, name)

  const res = await fetch(releaseFile(version, 'portable'), { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`${name}: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const chunks: Uint8Array[] = []
  let got = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    if (total) set({ status: 'downloading', percent: Math.min(99, Math.round((got / total) * 100)) })
  }
  const bytes = Buffer.concat(chunks)

  const sum = await fetch(releaseFile(version, 'portable.sha256'), { redirect: 'follow' })
  if (!sum.ok) throw new Error(`${name}.sha256: HTTP ${sum.status}`)
  const expected = (await sum.text()).trim().split(/\s+/)[0]?.toLowerCase()
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (!expected || expected !== actual) throw new Error(`${name} does not match its SHA-256: not used`)
  await writeFile(zip, bytes)

  // Windows 10 and later have tar (bsdtar), which reads zips.
  const out = join(dir, 'files')
  await mkdir(out, { recursive: true })
  await run('tar.exe', ['-xf', zip, '-C', out], { windowsHide: true })
  await rm(zip, { force: true })
  // The exe at the top of the zip, or in one folder there: this copy's name, or any the app has had.
  const names = [...new Set([...EXE_NAMES, basename(app.getPath('exe'))])]
  for (const dir of [out, ...readdirSync(out).map((d) => join(out, d))]) {
    const exe = names.find((n) => existsSync(join(dir, n)))
    if (exe) return { dir, exe }
  }
  throw new Error(`${name} has no ${EXE_NAMES[0]}`)
}

/** On quitting: a script waits for this app to close, copies the new files over its folder and starts it again. */
async function handOverPortable(from: { dir: string; exe: string }): Promise<void> {
  const target = dirname(app.getPath('exe'))
  const old = app.getPath('exe')
  const exe = join(target, from.exe)
  const script = join(app.getPath('temp'), 'lokthar-install-update.cmd')
  const lines = [
    '@echo off',
    ':wait',
    `tasklist /NH /FI "PID eq ${process.pid}" 2>nul | find " ${process.pid} " >nul && (timeout /t 1 /nobreak >nul & goto wait)`,
    // The engine closes with the app; retried a while in case a file is still held.
    `robocopy "${from.dir}" "${target}" /E /R:30 /W:1 /NFL /NDL /NJH /NJS /NP >nul`,
    // Renamed: the old exe would start the new files under the old name; gone.
    ...(basename(old).toLowerCase() === from.exe.toLowerCase() ? [] : [`del /f /q "${old}" >nul 2>&1`]),
    `start "" "${exe}"`,
  ]
  await writeFile(script, lines.join('\r\n') + '\r\n')
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast('update:state', state)
}

const notesText = (notes: unknown): string | null =>
  typeof notes === 'string' ? notes : Array.isArray(notes) ? notes.map((n) => (n as { note?: string }).note ?? '').join('\n') : null

export function startUpdater(): void {
  // What electron-builder's publish says (app-update.yml), said here too, for the zip's copy.
  if (portable) autoUpdater.setFeedURL({ provider: 'github', ...RELEASE_REPO, releaseType: 'release' })
  autoUpdater.autoDownload = false
  // A downloaded update the user did not restart for goes in when the app quits.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: (m: unknown) => log(`update: ${String(m)}`), warn: (m: unknown) => log(`update: ${String(m)}`), error: (m: unknown) => log(`update: ${String(m)}`), debug: () => undefined }
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }))
  autoUpdater.on('update-available', (info) => {
    set({ status: 'available', latest: info.version, releasedAt: info.releaseDate ?? null, notes: notesText(info.releaseNotes), checkedAt: Date.now() })
    if (andInstall) updater.download()
  })
  autoUpdater.on('update-not-available', (info) => {
    andInstall = false
    set({ status: 'current', latest: info.version, checkedAt: Date.now() })
  })
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', () => {
    set({ status: 'ready', percent: 100 })
    if (andInstall) updater.install()
  })
  autoUpdater.on('error', (err) => {
    andInstall = false
    set({ status: 'error', error: err?.message ?? String(err), checkedAt: Date.now() })
  })
  if (state.status === 'dev') return
  setTimeout(() => updater.peek(), LOOK_AFTER_MS)
  setInterval(() => updater.peek(), LOOK_EVERY_MS)
}

export const updater = {
  get: (): UpdateState => state,
  /**
   * Look up the newest release only, nothing downloaded (the Updates page opened: its manual
   * download links name the newest version's files). Not again within a few minutes.
   */
  peek(): void {
    if (!['idle', 'current', 'error'].includes(state.status)) return
    if (state.checkedAt && Date.now() - state.checkedAt < PEEK_EVERY_MS) return
    andInstall = false
    void autoUpdater.checkForUpdates().catch((err: unknown) => set({ status: 'error', error: String(err) }))
  },
  /** Check, and when there is a newer version, download it, put it in and restart. */
  check(): void {
    if (state.status === 'dev' || state.status === 'checking' || state.status === 'downloading') return
    andInstall = true
    void autoUpdater.checkForUpdates().catch((err: unknown) => set({ status: 'error', error: String(err) }))
  },
  download(): void {
    if (state.status !== 'available' && state.status !== 'error') return
    // Asked for (Check, or Retry after an error): it goes all the way, as Check does.
    andInstall = true
    set({ status: 'downloading', percent: 0, error: null })
    if (portable) {
      const version = state.latest
      if (!version) return
      downloadPortable(version)
        .then((from) => {
          portableReady = from
          set({ status: 'ready', percent: 100 })
          if (andInstall) updater.install()
        })
        .catch((err: unknown) => {
          andInstall = false
          log(`update: portable download failed: ${String(err)}`)
          set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
        })
      return
    }
    void autoUpdater.downloadUpdate().catch((err: unknown) => set({ status: 'error', error: String(err) }))
  },
  /** Close, install silently over this copy, and start again. */
  install(): void {
    if (state.status !== 'ready') return
    log('update: restarting to install')
    if (portable) {
      if (!portableReady) return
      handOverPortable(portableReady)
        .then(() => app.quit())
        .catch((err: unknown) => set({ status: 'error', error: `could not start the update: ${String(err)}` }))
      return
    }
    autoUpdater.quitAndInstall(true, true)
  },
}
