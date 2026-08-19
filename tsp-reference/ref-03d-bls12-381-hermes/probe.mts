// ref-03d — BLS12-381 on Hermes, measured.
// Deterministic (fixed secret keys, no randomness source required): the point is
// byte-identical group/pairing/signature output across engines, plus honest timings
// for the operations a bbs-2023 stack would lean on (G1/G2 mul, hash-to-curve, pairing).
// Hermes CLI has `print` but no `console`.
declare const print: ((s: string) => void) | undefined
if (typeof console === 'undefined') {
  ;(globalThis as any).console = { log: (...a: unknown[]) => (print as any)(a.join(' ')) }
}

import { bls12_381 } from '@noble/curves/bls12-381.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

declare const globalThis: any

const lines: string[] = []
const say = (s: string) => { lines.push(s); console.log(s) }

const engine =
  typeof globalThis.HermesInternal === 'object' && globalThis.HermesInternal !== null
    ? `hermes ${globalThis.HermesInternal.getRuntimeProperties?.()['OSS Release Version'] ?? ''}`.trim()
    : `node ${typeof process !== 'undefined' ? process.version : '?'}`
console.log(`# engine: ${engine}`)
console.log(`# webcrypto subtle: ${typeof globalThis.crypto?.subtle}`)

const now: () => number = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now()
const time = (label: string, n: number, f: () => void) => {
  f() // warm-up, and JIT parity between engines is not the point — magnitude is
  const t0 = now()
  for (let i = 0; i < n; i++) f()
  const ms = (now() - t0) / n
  console.log(`# timing ${label}: ${ms.toFixed(1)} ms/op (n=${n})`)
}

// --- fixed material -------------------------------------------------------
const sk = new Uint8Array(32).fill(1) // 0x0101…01 < Fr order (leading byte 0x01 < 0x73)
const sk2 = new Uint8Array(32).fill(2)
const msg = utf8ToBytes('keyring ref-03d: does bls12-381 run here?')
const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_'

// --- short-signature scheme: pk in G2, sig in G1 (the BBS-relevant shape) --
const S = bls12_381.shortSignatures
const pk = S.getPublicKey(sk)
say(`pk-g2: ${pk.toHex(true)}`)

const msgPoint = S.hash(msg, DST)
say(`hash-to-g1: ${msgPoint.toHex(true)}`)

const sig = S.sign(msgPoint, sk)
say(`sig-g1: ${sig.toHex(true)}`)

const ok = S.verify(sig, msgPoint, pk)
const okForged = S.verify(sig, msgPoint, S.getPublicKey(sk2))
say(`verify: ${ok} forged-key-verify: ${okForged}`)

// --- pairing bilinearity: e(aG1, G2) == e(G1, aG2) -------------------------
const { G1, G2 } = bls12_381.longSignatures // just for the base points
const a = 0x1eefn
const P = bls12_381.G1.Point.BASE
const Q = bls12_381.G2.Point.BASE
const left = bls12_381.pairing(P.multiply(a), Q)
const right = bls12_381.pairing(P, Q.multiply(a))
const bilinear = bls12_381.fields.Fp12.eql(left, right)
say(`pairing-bilinear: ${bilinear}`)

// --- transcript ------------------------------------------------------------
const transcript = bytesToHex(sha256(utf8ToBytes(lines.join('\n'))))
console.log(`# transcript-sha256: ${transcript}`)
const pass = ok && !okForged && bilinear
console.log(pass ? 'RESULT: ALL PASS' : 'RESULT: FAIL')

// --- timings (printed after RESULT so they never affect the transcript) ----
time('g1-mul', 5, () => { P.multiply(0x123456789abcdefn) })
time('g2-mul', 5, () => { Q.multiply(0x123456789abcdefn) })
time('hash-to-g1', 5, () => { S.hash(msg, DST) })
time('sign', 5, () => { S.sign(msgPoint, sk) })
time('pairing', 3, () => { bls12_381.pairing(P, Q) })
time('verify(2 pairings)', 3, () => { S.verify(sig, msgPoint, pk) })
