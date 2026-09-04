// Deterministically signs the SYNTHETIC fixtures with real Ed25519 keys via
// eddsa-jcs-2022 and freezes the public keys in fixtures/keys.json.
//
// Test keys only: each half's private-key seed is sha256("ref-07:" + its
// verificationMethod) — reproducible, obviously not secret, never used
// anywhere else. Re-running this script is idempotent (Ed25519 signing is
// deterministic and no timestamps are minted here).
//
// The CAPTURED fixture (edge-pairwise-captured.json) is untouched: its
// Ed25519Signature2018 proofs were minted and verified by Credo at capture.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { signCredential, verifyCredential } from './eddsa-jcs-2022.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SYNTHETIC = [
  'edge-pairwise.json',
  'edge-bootstrap-mdid.json',
  'edge-asymmetric.json',
  'edge-reused-pairwise.json',
  'edge-mixed-migration.json',
]

const utf8 = (s) => new TextEncoder().encode(s)
const seedFor = (verificationMethod) => sha256(utf8(`ref-07:${verificationMethod}`))
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

const keys = {}
for (const name of SYNTHETIC) {
  const path = join(here, 'fixtures', name)
  const fixture = JSON.parse(readFileSync(path, 'utf8'))
  for (const half of fixture.halves) {
    const vm = half.proof.verificationMethod
    const seed = seedFor(vm)
    keys[vm] = hex(ed25519.getPublicKey(seed))
    const options = {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      created: half.validFrom,
      verificationMethod: vm,
      proofPurpose: 'assertionMethod',
    }
    half.proof = signCredential(half, options, seed)
    const check = verifyCredential(half, ed25519.getPublicKey(seed))
    if (!check.verified) throw new Error(`self-check failed for ${name}/${vm}: ${check.reason}`)
  }
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`✓ signed + self-verified: ${name}`)
}

writeFileSync(
  join(here, 'fixtures', 'keys.json'),
  JSON.stringify(
    {
      description:
        'Ed25519 public keys (hex) for the SYNTHETIC fixtures, one per verificationMethod. Test keys: seeds are sha256("ref-07:" + verificationMethod) — deterministic, not secret. The captured fixture is verified at capture time by Credo instead (see its captureMeta).',
      publicKeys: keys,
    },
    null,
    2
  ) + '\n'
)
console.log('✓ fixtures/keys.json written')
