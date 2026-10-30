// node --test scripts/ota/
// The release a bundle names itself by: stamped into a copy of the app's otaRelease.ts, refused when the release or
// the file is not what it should be, and put back byte for byte.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import { RELEASE_FILE, RESTORED_ON, stampRelease, stampedSource, UNSTAMPED } from './release-stamp.mjs'

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'app')
const stampModule = new URL('./release-stamp.mjs', import.meta.url).href
const dirs = []
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** An app directory holding a copy of the real otaRelease.ts. */
const copyOfApp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-stamp-'))
  dirs.push(dir)
  mkdirSync(path.dirname(path.join(dir, RELEASE_FILE)), { recursive: true })
  cpSync(path.join(appDir, RELEASE_FILE), path.join(dir, RELEASE_FILE))
  return dir
}

test('the repository holds the unstamped line, so store builds and dev bundles name no release', () => {
  const source = readFileSync(path.join(appDir, RELEASE_FILE), 'utf8')
  assert.equal(source.split(UNSTAMPED).length, 2)
})

test('stamps the release in place of null, and puts the file back exactly', () => {
  const dir = copyOfApp()
  const file = path.join(dir, RELEASE_FILE)
  const before = readFileSync(file, 'utf8')
  const restore = stampRelease(dir, '276.10')
  const stamped = readFileSync(file, 'utf8')
  assert.match(stamped, /^export const OTA_RELEASE: string \| null = "276\.10"$/m)
  assert.doesNotMatch(stamped, /= null$/m)
  assert.equal(stamped.replace('= "276.10"\n', '= null\n'), before)
  restore()
  restore()
  assert.equal(readFileSync(file, 'utf8'), before)
})

for (const release of ['276', '276.x', '', '276.10; alert(1)', undefined]) {
  test(`refuses the release ${JSON.stringify(release)}`, () => {
    assert.throws(() => stampedSource(UNSTAMPED, release), /is not <store build>\.<n>/)
  })
}

test('refuses a file without the unstamped line, or with it twice, and leaves the file alone', () => {
  for (const source of ['export const OTA_RELEASE: string | null = "276.9"\n', UNSTAMPED + UNSTAMPED]) {
    const dir = copyOfApp()
    const file = path.join(dir, RELEASE_FILE)
    writeFileSync(file, source)
    assert.throws(() => stampRelease(dir, '276.10'), /exactly one unstamped OTA_RELEASE line/)
    assert.equal(readFileSync(file, 'utf8'), source)
  }
})

/**
 * A child process that stamps `dir`'s file, registers the restore (or, with `guard` false, does not), says "stamped"
 * and waits; it is then sent `signal`. Resolves with how it ended and what the file holds after.
 */
const stampThenSignal = (dir, signal, { guard = true } = {}) =>
  new Promise((resolve, reject) => {
    const script = `
      import { restoreOnExit, stampRelease } from ${JSON.stringify(stampModule)}
      const restore = stampRelease(${JSON.stringify(dir)}, '276.10')
      if (${guard}) restoreOnExit(restore)
      console.log('stamped')
      setInterval(() => {}, 1000)
    `
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    child.stdout.on('data', (chunk) => String(chunk).includes('stamped') && child.kill(signal))
    child.on('error', reject)
    child.on('exit', (code, endedBy) =>
      resolve({ code, signal: endedBy, source: readFileSync(path.join(dir, RELEASE_FILE), 'utf8') })
    )
  })

for (const signal of RESTORED_ON) {
  test(`a publish stopped by ${signal} puts the file back, and still ends by ${signal}`, async () => {
    const dir = copyOfApp()
    const before = readFileSync(path.join(dir, RELEASE_FILE), 'utf8')
    const ended = await stampThenSignal(dir, signal)
    assert.equal(ended.signal, signal)
    assert.equal(ended.source, before)
  })
}

test('without the restore registered, a SIGTERM leaves the file stamped (what the guard is for)', async () => {
  const ended = await stampThenSignal(copyOfApp(), 'SIGTERM', { guard: false })
  assert.equal(ended.signal, 'SIGTERM')
  assert.match(ended.source, /= "276\.10"$/m)
})

test('SIGKILL cannot be caught: the file stays stamped, which the next publish refuses as a dirty tree', async () => {
  const ended = await stampThenSignal(copyOfApp(), 'SIGKILL')
  assert.equal(ended.signal, 'SIGKILL')
  assert.match(ended.source, /= "276\.10"$/m)
})
