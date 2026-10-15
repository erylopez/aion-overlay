/**
 * Put the app icon in place: Lokthar's logo, kept in branding/ (icon.ico at 16-256 px for the exe
 * and installer, icon.png at 256 px), made from the site's lokthar_logo.png, trimmed and padded
 * square.
 *
 *   node scripts/make-icon.mjs
 *
 * Copies them to build/ (electron-builder's resources, gitignored) and the PNG to
 * src/renderer/public/icon.png (the bubble, the tray and the window icon). For new artwork,
 * replace the two files in branding/.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')

mkdirSync(join(APP, 'build'), { recursive: true })
copyFileSync(join(APP, 'branding', 'icon.ico'), join(APP, 'build', 'icon.ico'))
copyFileSync(join(APP, 'branding', 'icon.png'), join(APP, 'build', 'icon.png'))
mkdirSync(join(APP, 'src', 'renderer', 'public'), { recursive: true })
copyFileSync(join(APP, 'branding', 'icon.png'), join(APP, 'src', 'renderer', 'public', 'icon.png'))
console.log('icon: branding/icon.ico, icon.png -> build/, src/renderer/public/icon.png')
