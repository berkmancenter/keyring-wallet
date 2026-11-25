# SEDI/KERI test fixtures

`k0-utah-v2/` is a copy of the K0 test kit's output (`PROVENANCE.json` inside says how it was made: keripy 7143832
run directly on a GitHub Actions runner, run 42874885513). A made-up State chain: root, Org Unit, Issuing Agent, Guardian
and Social Authorization credentials, their registries' TELs, the issuers' KELs, and the bad cases a phone must refuse.
Deviations from Utah's design, recorded there too: SAIDs are Blake3 (keripy's high-level API takes no digest code
there), not SHA2-256 everywhere; edges are I2I (keripy's verifiers refuse DI2I); the KELs have no witnesses.

## `cesr-ts-reads.json`: FROZEN expected values

`cesr-ts-reads.json` is what cesr-ts 2.0.0 reads from each KEL stream in `k0-utah-v2/` (`kel-*.cesr`, `icp-*.cesr`),
in the fields the verifier uses. It is the reference our own reader (`../../cesr/reader.ts`) must match byte for byte,
and it is **frozen**:

- **Generated** 2026-11-10 (18:33 CST, 2026-11-11T00:33Z), once, outside this repo.
- **Against** `cesr-ts@2.0.0` from npm (installed under the alias `cesr2`), on Node 20.19.2 / npm 10.8.2.
- **Over** the K0 streams in `k0-utah-v2/`, byte-identical to the kit output of ref-21 at keyring-wallet commit
  `56551418f67f2e06f346b4d57778b1dd328b4fc7` (`e2e/k0k3/k0/ref21`, the `k0k3-keri-kit` workflow, GitHub Actions run
  42874885513). `k0-utah-v2/PROVENANCE.json` records how that output was made (keripy 7143832).

To regenerate, from this directory, in an empty scratch directory outside the repo (`$S` below):

    S=$(mktemp -d) && (cd "$S" && npm init -y >/dev/null && npm install --ignore-scripts cesr2@npm:cesr-ts@2.0.0)
    node cesr-ts-reads.gen.mjs "$S/node_modules" k0-utah-v2 "$S/cesr-ts-reads.json"
    cmp "$S/cesr-ts-reads.json" cesr-ts-reads.json

Re-run on 2026-11-10 with exactly those commands, the output was byte-identical (`cmp` silent). Regenerate only if
`k0-utah-v2/` itself is replaced by a new kit run, and then record the new date, versions and commit here.

**A failing cross-check row is fixed in the parser, never by editing this file.** The file is what the reference
implementation reads, so a difference is a reader bug until shown otherwise; changing the expectation to match our
output would turn the check into a recording of it.

cesr-ts is not a dependency of this package; the generator is kept only so the reference can be remade.
