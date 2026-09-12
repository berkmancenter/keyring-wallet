// ref-13 — T1: does @bifold/trust-tasks's JCS canonicalizer (the `canonicalize`
// npm package) agree with @openvtc/trust-tasks's own (`canonicalJson`)?
//
// docs/plans/reference-app-sdk-packaging/2026-09-01-al.md §1, "Remediation,
// phased", T1: "prove or disprove the divergence, before changing any code."
// This is a corpus diff, not a migration — see README.md for the full
// framing and the version-gap finding this run surfaces.
//
// No production code is touched. `canonicalize` is imported from this repo's
// real, installed dependency (the same one documentProof.ts imports).
// `canonicalJson` is a frozen vendored copy — see vendor/upstream-canonical.mjs
// for exactly where it came from and why it is not simply imported from
// @openvtc/trust-tasks like the rest of this ladder does.

import { createHash } from 'node:crypto'
import canonicalize from 'canonicalize'
import { canonicalJson as upstreamCanonicalJson } from './vendor/upstream-canonical.mjs'
import { corpus } from './fixtures/corpus.mjs'

const QUIET = process.argv.includes('--quiet')
const log = (...a) => QUIET || console.log(...a)

// Same DigestMultibase construction @bifold/trust-tasks's documentProof.ts
// uses (multibase(base58btc) over multihash(sha-256) over the canonical
// bytes) — reimplemented here dependency-free, same pattern ref-06w4 and
// ref-06w3 already use in this ladder.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58btc(bytes) {
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex')), out = ''
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n }
  // leading zero bytes -> leading '1's, per base58 convention
  for (const b of bytes) { if (b === 0) out = '1' + out; else break }
  return out
}
function digestMultibaseOverCanonicalString(canonicalString) {
  const bytes = Buffer.from(canonicalString, 'utf8')
  const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), createHash('sha256').update(bytes).digest()])
  return 'z' + base58btc(multihash)
}

let total = 0
let byteIdentical = 0
let digestIdentical = 0
const divergences = []

log('ref-13-jcs-canonicalizer-corpus — bifold `canonicalize` vs vendored upstream `canonicalJson`\n')

let requiredTotal = 0
let requiredDivergent = 0

for (const { name, value, bonus } of corpus) {
  total++
  if (!bonus) requiredTotal++
  let bifoldBytes, upstreamBytes
  let bifoldError = null
  let upstreamError = null

  try {
    bifoldBytes = canonicalize(value)
  } catch (e) {
    bifoldError = e
  }
  try {
    upstreamBytes = upstreamCanonicalJson(value)
  } catch (e) {
    upstreamError = e
  }

  if (bifoldError || upstreamError) {
    divergences.push({
      name,
      bonus: !!bonus,
      reason: 'threw',
      bifoldError: bifoldError?.message,
      upstreamError: upstreamError?.message,
    })
    if (!bonus) requiredDivergent++
    log(`  ✗ ${name} — THREW (bifold: ${bifoldError?.message ?? 'ok'} | upstream: ${upstreamError?.message ?? 'ok'})`)
    continue
  }

  const bytesMatch = bifoldBytes === upstreamBytes
  if (bytesMatch) byteIdentical++

  let digestsMatch = null
  if (bifoldBytes !== undefined && upstreamBytes !== undefined) {
    const bifoldDigest = digestMultibaseOverCanonicalString(bifoldBytes)
    const upstreamDigest = digestMultibaseOverCanonicalString(upstreamBytes)
    digestsMatch = bifoldDigest === upstreamDigest
    if (digestsMatch) digestIdentical++
    if (!bytesMatch) {
      divergences.push({
        name,
        bonus: !!bonus,
        reason: 'bytes-differ',
        bifoldBytes,
        upstreamBytes,
        digestsMatch,
      })
      if (!bonus) requiredDivergent++
    }
  }

  log(`  ${bytesMatch ? '✓' : '✗'} ${name}${bonus ? ' [bonus, beyond the plan\'s four categories]' : ''}${bytesMatch ? '' : `\n      bifold:   ${bifoldBytes}\n      upstream: ${upstreamBytes}`}`)
}

log(`\n${byteIdentical}/${total} byte-identical, ${digestIdentical}/${total} digestMultibase-identical (${requiredTotal - requiredDivergent}/${requiredTotal} within the plan's required four categories).\n`)

if (divergences.length > 0) {
  log('DIVERGENCES (this is T1 evidence — keep these as permanent fixtures, per the plan):')
  for (const d of divergences) log('  ' + JSON.stringify(d))
} else {
  log('No divergences found across this corpus: byte-identical and digest-identical on every case.')
}

// --quiet is used by the bottom-up ladder runner (`for d in ref-*/; do (cd
// "$d" && npm run -s check); done`), which greps for a leading FAIL/pass line.
// Only a divergence in the plan's REQUIRED four categories fails the rung —
// the appended bonus case is deliberately left in as a documented, non-gating
// finding (see README.md).
if (requiredDivergent > 0) {
  console.log(`FAIL ref-13: ${requiredDivergent}/${requiredTotal} required cases diverge`)
  process.exitCode = 1
} else {
  const bonusNote = divergences.length > 0 ? ` (${divergences.length} non-gating bonus divergence(s), see README.md)` : ''
  console.log(`pass ref-13: ${requiredTotal}/${requiredTotal} required cases byte-identical${bonusNote}`)
}
