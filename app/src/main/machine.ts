/**
 * This PC's hash, sent as X-A2-Machine with everything the app asks of nyerk.app (updates, the
 * shared timers): what the server's ban list keys on, so a ban outlasts reinstalling the app.
 *
 * SHA-256 of Windows' MachineGuid (set when Windows is installed) with this app's salt: the raw id
 * never leaves the PC, and the hash matches nothing another app sends for the same machine. Where
 * the registry cannot be read, a random id kept in userData stands in.
 */
import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Kept from before the rename to Nyerk: a new salt would give every PC a new hash (and lift every ban).
const SALT = 'aion2-pet-tracker/machine/v1'
let cached: string | null = null

function machineGuid(): string | null {
  try {
    const out = execFileSync(
      join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'reg.exe'),
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 },
    )
    return /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(out)?.[1]?.toLowerCase() ?? null
  } catch {
    return null
  }
}

function fallbackId(): string {
  const file = join(app.getPath('userData'), 'machine-id')
  try {
    const id = readFileSync(file, 'utf8').trim()
    if (id) return id
  } catch {
    // made below
  }
  const id = randomUUID()
  try {
    writeFileSync(file, id)
  } catch {
    // this run only
  }
  return id
}

export function machineHash(): string {
  cached ??= createHash('sha256').update(`${SALT}:${machineGuid() ?? fallbackId()}`).digest('hex')
  return cached
}
