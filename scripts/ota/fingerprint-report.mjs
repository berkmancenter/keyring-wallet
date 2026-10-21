/**
 * The native fingerprint a checkout computed (app/fingerprint.json, written by
 * scripts/ota/native-config.mjs), and what differs between two of them.
 *
 *   node scripts/ota/fingerprint-report.mjs [app/fingerprint.json]
 *       each platform's hash, then every source (type, hash, path) in a log group
 *   node scripts/ota/fingerprint-report.mjs --diff <a.json> <b.json>
 *       the sources whose hash differs or that only one side has; exit 1 if any
 *
 * A phone is offered a bundle only when the bundle's fingerprint equals the one
 * its build carries. The store iOS build computes it on a macOS runner after
 * pod install (staging.yaml); the publisher computes it on Ubuntu
 * (ota-publish.yml). This shows whether, and where, they disagree.
 */
import { readFileSync } from 'node:fs'

const PLATFORMS = ['ios', 'android']

const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
const sourceId = (s) => s.filePath ?? s.id ?? s.type
// Keyed by id, with a repeated id numbered by occurrence (id#2, id#3, …), so two
// sources sharing an id are both compared rather than one silently replacing the other.
const byId = (sources = []) => {
  const seen = new Map()
  const out = new Map()
  for (const s of sources) {
    const id = sourceId(s)
    const n = (seen.get(id) ?? 0) + 1
    seen.set(id, n)
    out.set(n === 1 ? id : `${id}#${n}`, s)
  }
  return out
}

export const diffFingerprints = (a, b) => {
  const out = []
  for (const platform of PLATFORMS) {
    const left = byId(a[platform]?.sources)
    const right = byId(b[platform]?.sources)
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const l = left.get(id)
      const r = right.get(id)
      if (!l || !r || (l.hash ?? null) !== (r.hash ?? null)) {
        out.push({ platform, id, a: l?.hash ?? (l ? 'no hash' : 'absent'), b: r?.hash ?? (r ? 'no hash' : 'absent') })
      }
    }
  }
  return out
}

const isMain = process.argv[1] && process.argv[1].endsWith('fingerprint-report.mjs')
if (isMain) {
  const args = process.argv.slice(2)
  if (args[0] === '--diff') {
    const [, fa, fb] = args
    if (!fa || !fb) {
      console.error('usage: fingerprint-report.mjs --diff <a.json> <b.json>')
      process.exit(2)
    }
    const a = read(fa)
    const b = read(fb)
    for (const p of PLATFORMS) console.log(`${p}: ${a[p]?.hash ?? '?'} vs ${b[p]?.hash ?? '?'}`)
    const diff = diffFingerprints(a, b)
    for (const d of diff) console.log(`DIFF ${d.platform} ${d.id}: ${d.a} vs ${d.b}`)
    console.log(diff.length ? `${diff.length} source(s) differ` : 'no source differs')
    process.exit(diff.length ? 1 : 0)
  }
  const f = read(args[0] ?? 'app/fingerprint.json')
  for (const p of PLATFORMS)
    console.log(`fingerprint ${p}: ${f[p]?.hash ?? '?'} (${f[p]?.sources?.length ?? 0} sources)`)
  for (const p of PLATFORMS) {
    console.log(`::group::${p} fingerprint sources`)
    for (const s of f[p]?.sources ?? []) console.log(`${s.type} ${s.hash ?? '-'} ${sourceId(s)}`)
    console.log('::endgroup::')
  }
}
