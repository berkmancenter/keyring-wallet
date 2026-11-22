/**
 * Our CESR reader against the reference: on every K0 stream it must read what cesr-ts 2.0.0 reads (generated once,
 * outside this repo: fixtures/README.md). Then a row per supported code, and the refusals.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import { COUNTERS, DIGESTS, INDEXED_SIGS, KEYS } from '../cesr/codes'
import { readKelStream, type KelFrame } from '../cesr/reader'
import { verifySignature } from '../cesr/signatures'

// Pass-through recorders on the two curve verifiers (noble freezes its objects, so jest.spyOn cannot wrap them).
// Every row sees the real math; the cross-curve row reads the call counts.
jest.mock('@noble/curves/nist.js', () => {
  const real = jest.requireActual('@noble/curves/nist.js')
  return { ...real, p256: { ...real.p256, verify: jest.fn(real.p256.verify) } }
})
jest.mock('@noble/curves/ed25519.js', () => {
  const real = jest.requireActual('@noble/curves/ed25519.js')
  return { ...real, ed25519: { ...real.ed25519, verify: jest.fn(real.ed25519.verify) } }
})
import { ed25519 } from '@noble/curves/ed25519.js'
import { p256 } from '@noble/curves/nist.js'

const FX = join(__dirname, 'fixtures', 'k0-utah-v2')
const reference = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cesr-ts-reads.json'), 'utf8')) as {
  generator: string
  files: Record<string, Record<string, unknown>[]>
}
const streams = readdirSync(FX)
  .filter((f) => /^(kel|icp)-.*\.cesr$/.test(f))
  .sort()
const bytesOf = (f: string) => new Uint8Array(readFileSync(join(FX, f)))
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')

/** Our frame, in the shape the reference was written in. */
const asReference = (frames: KelFrame[]) =>
  frames.map(({ body: b, groups }) => ({
    ilk: b.ilk,
    sn: b.sn,
    pre: b.pre,
    said: b.said,
    prior: b.prior ?? null,
    keys: b.keys,
    ndigs: b.ndigs,
    backs: b.backs,
    bn: b.bn ?? null,
    kt: b.kt,
    seals: b.seals ?? null,
    rawLength: b.raw.length,
    rawText: b.text,
    groups: groups.map((g) => ({
      name: g.name,
      items: g.items.map((i) => ({ index: i.index, raw: hex(i.raw), code: i.code })),
    })),
  }))

describe('the CESR reader, against cesr-ts 2.0.0 on every K0 stream', () => {
  it('covers the same streams as the reference', () => {
    expect(reference.generator).toBe('cesr-ts@2.0.0')
    expect(streams).toEqual(Object.keys(reference.files).sort())
    expect(streams).toHaveLength(12)
  })

  it.each(streams)('%s reads exactly as cesr-ts reads it', (file) => {
    const read = readKelStream(bytesOf(file))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(asReference(read.frames)).toEqual(reference.files[file])
  })
})

describe('each supported code', () => {
  const first = (file: string) => {
    const read = readKelStream(bytesOf(file))
    if (!read.ok) throw new Error(read.detail)
    return read.frames[0]
  }

  it('-K ControllerIdxSigs with an indexed P-256 signature (E) by a 1AAJ key verifies; a flipped bit does not', () => {
    const f = first('kel-roy.cesr')
    expect(f.groups.map((g) => g.name)).toEqual(['ControllerIdxSigs'])
    const sig = f.groups[0].items[0]
    expect([sig.code, sig.index, sig.raw.length]).toEqual(['E', 0, 64])
    expect(f.body.keys?.[0].slice(0, 4)).toBe('1AAJ')
    expect(verifySignature(f.body.keys![0], sig, f.body.raw)).toBe(true)
    const flipped = { ...sig, raw: sig.raw.map((b, i) => (i === 10 ? b ^ 1 : b)) }
    expect(verifySignature(f.body.keys![0], flipped, f.body.raw)).toBe(false)
  })

  it('a non-transferable P-256 key (1AAI) verifies its own inception', () => {
    const f = first('icp-jordan-nt.cesr')
    expect(f.body.keys?.[0].slice(0, 4)).toBe('1AAI')
    expect(verifySignature(f.body.keys![0], f.groups[0].items[0], f.body.raw)).toBe(true)
  })

  it('a non-transferable Ed25519 key (B) with an indexed Ed25519 signature (A) verifies its own inception', () => {
    const f = first('icp-jordan-nt-ed.cesr')
    expect([f.body.keys?.[0][0], f.groups[0].items[0].code]).toEqual(['B', 'A'])
    expect(verifySignature(f.body.keys![0], f.groups[0].items[0], f.body.raw)).toBe(true)
  })

  it('a signature never verifies under a key of the other curve', () => {
    const p = first('kel-roy.cesr')
    const ed = first('icp-jordan-nt-ed.cesr')
    expect(verifySignature(ed.body.keys![0], p.groups[0].items[0], p.body.raw)).toBe(false)
    expect(verifySignature(p.body.keys![0], ed.groups[0].items[0], ed.body.raw)).toBe(false)
  })

  it('a cross-curve pair is refused by the code table, before any curve math runs (control: a same-curve pair reaches it)', () => {
    // The row above passes even without the curve check, because the math happens to fail; this one pins the check.
    const p = first('kel-roy.cesr')
    const ed = first('icp-jordan-nt-ed.cesr')
    const pv = p256.verify as jest.Mock
    const ev = ed25519.verify as jest.Mock
    pv.mockClear()
    ev.mockClear()
    expect(verifySignature(ed.body.keys![0], p.groups[0].items[0], p.body.raw)).toBe(false)
    expect(verifySignature(p.body.keys![0], ed.groups[0].items[0], ed.body.raw)).toBe(false)
    expect([pv.mock.calls.length, ev.mock.calls.length]).toEqual([0, 0])
    expect(verifySignature(p.body.keys![0], p.groups[0].items[0], p.body.raw)).toBe(true)
    expect(pv.mock.calls).toHaveLength(1)
  })

  it('the code table is exactly what the fixtures carry', () => {
    expect(Object.keys(COUNTERS)).toEqual(['-K'])
    expect(Object.keys(INDEXED_SIGS).sort()).toEqual(['A', 'E'])
    expect(Object.keys(KEYS).sort()).toEqual(['1AAI', '1AAJ', 'B'])
    expect(Object.keys(DIGESTS).sort()).toEqual(['E', 'I'])
  })
})

describe('what it refuses, never skips', () => {
  const roy = () => new TextDecoder().decode(bytesOf('kel-roy.cesr'))
  const read = (text: string) => readKelStream(new TextEncoder().encode(text))

  it('an unknown count code is unsupportedCesr (control: the real stream reads)', () => {
    expect(read(roy()).ok).toBe(true)
    expect(read(roy().replace('-KAW', '-LAW'))).toMatchObject({ ok: false, reason: 'unsupportedCesr' })
  })

  it('an unknown indexed-signature code is unsupportedCesr', () => {
    expect(read(roy().replace('-KAWE', '-KAWC'))).toMatchObject({ ok: false, reason: 'unsupportedCesr' })
  })

  it('a version or serialisation it does not read is unsupportedCesr', () => {
    expect(read(roy().replace('KERICAACAAJSON', 'KERICAACAACBOR'))).toMatchObject({
      ok: false,
      reason: 'unsupportedCesr',
    })
  })

  it('a group whose count runs past the stream, or a body cut short, is malformedCesr', () => {
    const text = roy()
    const cut = text.slice(0, text.indexOf('-KAW') + 40)
    expect(read(cut)).toMatchObject({ ok: false, reason: 'malformedCesr' })
    expect(read(text.slice(0, 120))).toMatchObject({ ok: false, reason: 'malformedCesr' })
  })

  it('a count one quadlet short leaves a signature split across the group edge: refused, not read short', () => {
    expect(read(roy().replace('-KAW', '-KAV'))).toMatchObject({ ok: false })
  })
})
