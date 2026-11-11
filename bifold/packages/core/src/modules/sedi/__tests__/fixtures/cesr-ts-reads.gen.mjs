// Run once, outside the repo: what cesr-ts 2.0.0 reads from each K0 KEL stream, in the fields replayKel uses.
/* eslint-disable no-console -- a run-once generator, run with node outside the app */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const [nm, fxDir, out] = process.argv.slice(2)
const pj = JSON.parse(fs.readFileSync(path.join(nm, 'cesr2', 'package.json'), 'utf8'))
const cesr = await import(pathToFileURL(path.join(nm, 'cesr2', pj.exports['.'].import)).href)
const hex = (u) => Buffer.from(u).toString('hex')
const td = new TextDecoder()
const result = { generator: 'cesr-ts@' + pj.version, files: {} }
for (const f of fs.readdirSync(fxDir).filter((f) => /^(kel|icp)-.*\.cesr$/.test(f)).sort()) {
  const frames = cesr.parseBytes(fs.readFileSync(path.join(fxDir, f)))
  result.files[f] = frames.map((fr) => {
    const b = fr.body
    const raw = b.raw instanceof Uint8Array ? b.raw : new TextEncoder().encode(b.raw)
    return {
      ilk: b.ilk, sn: b.sn, pre: b.pre, said: b.said, prior: b.prior ?? null,
      keys: b.keys ?? null, ndigs: b.ndigs ?? null, backs: b.backs ?? null, bn: b.bn ?? null,
      kt: String(b.tholder?.sith ?? b.tholder ?? ''), seals: b.seals ?? null,
      rawLength: raw.length, rawText: td.decode(raw),
      groups: (fr.attachments ?? []).map((g) => ({ name: g.name, items: g.items.map((i) => ({ index: i[0].index, raw: hex(i[0].raw), code: i[0].code })) })),
    }
  })
}
fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n')
console.log('wrote', Object.keys(result.files).length, 'files')
