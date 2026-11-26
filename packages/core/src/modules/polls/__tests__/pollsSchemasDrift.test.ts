/**
 * The voter's vendored bundles (fixtures/polls-schemas) are byte-identical to upstream at the commits they were
 * copied from. They come from the Verifiable Trust Infrastructure repository, not the Trust Tasks registry, and in
 * two goes: the first eight at one commit, the later generations at another (the fixture's README; both commits are
 * in its `PROVENANCE.sha`). Skips only where the checkout has no `external/` (CI has none, by design).
 */
import { join } from 'path'

import { expectNoDrift, registryPath } from '../../trust-tasks/__tests__/fixtures/registryDrift'

const DIR = join(__dirname, 'fixtures', 'polls-schemas')
const SOURCE = 'verifiable-trust-infrastructure'

/** Copied 2026-11-02 (README, "Attribution"). */
const FIRST = '3139e00ec202351dc253d89b5b4f9885d7ae071e'
/** Copied 2026-11-04 (README, "The later generations"). */
const LATER = 'e84bb1eda56e64a0e4ea4b151423ab30aa654cb5'

const VTC = 'vti-specs-vtc/trust-tasks/vtc/elections'
const VTA = 'vti-specs-vta/trust-tasks/vta/pcs'

const at = (commit: string, path: string) => ({ path, commit })

const VENDORED = {
  'vtc-elections-list-0.3.bundle.json': at(FIRST, `${VTC}/list/0.3.bundle.json`),
  'vtc-elections-show-0.2.bundle.json': at(FIRST, `${VTC}/show/0.2.bundle.json`),
  'vtc-elections-tickets-issue-0.1.bundle.json': at(FIRST, `${VTC}/tickets/issue/0.1.bundle.json`),
  'vta-pcs-voter-register-0.2.bundle.json': at(FIRST, `${VTA}/voter/register/0.2.bundle.json`),
  'vta-pcs-voter-accept-0.1.bundle.json': at(FIRST, `${VTA}/voter/accept/0.1.bundle.json`),
  'vta-pcs-vote-0.2.bundle.json': at(FIRST, `${VTA}/vote/0.2.bundle.json`),
  'voting-ballot-cast-0.1.bundle.json': at(FIRST, 'vti-specs-core/trust-tasks/voting/ballot/cast/0.1.bundle.json'),
  'vta-pcs-voter-receipt-0.1.bundle.json': at(FIRST, `${VTA}/voter/receipt/0.1.bundle.json`),
  'vtc-elections-list-0.5.bundle.json': at(LATER, `${VTC}/list/0.5.bundle.json`),
  'vtc-elections-show-0.3.bundle.json': at(LATER, `${VTC}/show/0.3.bundle.json`),
  'vtc-elections-show-0.6.bundle.json': at(LATER, `${VTC}/show/0.6.bundle.json`),
  'vtc-elections-tickets-issue-0.3.bundle.json': at(LATER, `${VTC}/tickets/issue/0.3.bundle.json`),
  'vta-pcs-voter-register-0.3.bundle.json': at(LATER, `${VTA}/voter/register/0.3.bundle.json`),
  'vta-pcs-voter-register-0.5.bundle.json': at(LATER, `${VTA}/voter/register/0.5.bundle.json`),
  'vta-pcs-vote-0.3.bundle.json': at(LATER, `${VTA}/vote/0.3.bundle.json`),
  'vta-pcs-vote-0.4.bundle.json': at(LATER, `${VTA}/vote/0.4.bundle.json`),
}

describe('the vendored voter bundles still match upstream', () => {
  const maybe = registryPath(DIR, SOURCE) ? test : test.skip

  maybe('byte-identical to the Verifiable Trust Infrastructure commit each was copied at', () => {
    expectNoDrift(DIR, VENDORED, { source: SOURCE })
  })
})
