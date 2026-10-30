// The OTA release a bundle is published as, written into the app's own JS just before the bundle is built
// (app/scripts/ota-deploy.mjs), so the Developer screen and problem reports can name it (app/src/ota/otaRelease.ts).
// The file is put back afterwards: the repository always holds the unstamped line.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** The stamped file, from the app directory. */
export const RELEASE_FILE = path.join('src', 'ota', 'otaRelease.ts')
export const UNSTAMPED = 'export const OTA_RELEASE: string | null = null\n'

/** The file's source with the release in place of null. Refuses a malformed release, or a file without the line. */
export const stampedSource = (source, release) => {
  if (!/^\d+\.\d+$/.test(String(release))) throw new Error(`release "${release}" is not <store build>.<n>`)
  const at = source.indexOf(UNSTAMPED)
  if (at < 0 || source.indexOf(UNSTAMPED, at + 1) >= 0) {
    throw new Error(`${RELEASE_FILE} does not hold exactly one unstamped OTA_RELEASE line; not guessing where it goes`)
  }
  return source.replace(UNSTAMPED, `export const OTA_RELEASE: string | null = ${JSON.stringify(release)}\n`)
}

/** Stamps the release into the app's file; returns what puts the file back as it was (safe to call more than once). */
export const stampRelease = (appDir, release) => {
  const file = path.join(appDir, RELEASE_FILE)
  const original = readFileSync(file, 'utf8')
  writeFileSync(file, stampedSource(original, release))
  let restored = false
  return () => {
    if (restored) return
    writeFileSync(file, original)
    restored = true
  }
}
