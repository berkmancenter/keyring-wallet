/**
 * The approve view: Keyring's own copy keys around the VTA's summaries (VTI hcp.md §5.1), which are kept verbatim and in order.
 */
import { readHcpEffects, type HcpEffects } from '../approvals'
import { hcpApproveView } from '../approveView'
import { hcpText } from '../copy'
import { CLIENT_VID, GRANT, GRANT_EXPIRES_AT, hcpApproval, hcpEffects, ROWS, THREAD } from './fixtures/hcpApproval'

jest.mock('../../../trust-tasks/module/vtaAgent', () => ({ vtaAgent: {} }))

function read(effects = hcpEffects()): HcpEffects {
  const read = readHcpEffects(hcpApproval({ effects }))
  if (!read) throw new Error('fixture not read')
  return read
}

describe('hcpApproveView', () => {
  it('is the copy keys, the rows and what the record needs', () => {
    expect(hcpApproveView('My helper', read(), THREAD)).toEqual({
      title: { key: 'ApproveTitle', params: { name: 'My helper' } },
      rows: ROWS,
      warning: { key: 'ApproveOwnTerminal' },
      notSignIn: { key: 'ApproveNotSignIn' },
      approve: { key: 'Approve' },
      clientVid: CLIENT_VID,
      threadId: THREAD,
      expiresAt: GRANT_EXPIRES_AT,
      operator: { id: 'did:web:labs.example', name: 'Example Labs' },
      persistence: 'temporary',
      maxUseSeconds: 600,
    })
  })

  // The view shows a persistent request as sent; Approve declines it (approveFlow.test.ts, S5).
  it('carries a detail grantId when the request sends one, and the term’s persistence as sent', () => {
    const effects = hcpEffects()
    effects[0] = { ...effects[0], detail: { ...(effects[0].detail as object), grantId: GRANT } }
    effects[4] = { ...effects[4], detail: { persistence: 'persistent', expiresAt: GRANT_EXPIRES_AT } }
    const view = hcpApproveView('My helper', read(effects), THREAD)
    expect(view.grantId).toBe(GRANT)
    expect(view.persistence).toBe('persistent')
  })

  it('B3: shows choose:true purposes as the purposes approving allows, by summary, and offers no picker', () => {
    const choose = { purpose: 'https://example.org/purpose/research', description: 'research', choose: true }
    const effects = hcpEffects().flatMap((e, i) =>
      i === 2
        ? [
            { kind: 'hcpPurpose', summary: 'For research.', detail: choose },
            { kind: 'hcpPurpose', summary: 'For your diet.', detail: { ...choose, purpose: 'https://example.org/d' } },
          ]
        : [e]
    )
    const view = hcpApproveView('My helper', read(effects), THREAD)
    expect(view.rows).toEqual(ROWS.filter((_, i) => i !== 2))
    expect(view.purposesAllowed).toEqual({
      key: 'ApproveAllowsPurposes',
      params: { name: 'My helper' },
      rows: ['For research.', 'For your diet.'],
    })
    expect(Object.keys(view)).not.toContain('chosenPurpose')
    // control: a request that names its purpose has no such line.
    expect(hcpApproveView('My helper', read(), THREAD).purposesAllowed).toBeUndefined()
  })

  describe('"not signing in" is Keyring’s own line on every consent, never an effect', () => {
    const NOT_SIGN_IN = 'Approving gives access. It is not signing in.'
    const SIX_KINDS = ['hcpClient', 'hcpCategory', 'hcpPurpose', 'hcpUseUntil', 'hcpGrantTerm', 'hcpDirectives']

    it('shows it for a consent with only the six §5.1 kinds, none of which says it', () => {
      const effects = hcpEffects()
      expect(effects.map((e) => e.kind)).toEqual(SIX_KINDS)
      const view = hcpApproveView('My helper', read(effects), THREAD)
      expect(view.notSignIn).toEqual({ key: 'ApproveNotSignIn' })
      expect(hcpText(view.notSignIn.key, 'en')).toBe(NOT_SIGN_IN)
      expect(view.rows).not.toContain(NOT_SIGN_IN)
    })

    it('shows it for a consent with an unknown kind, which is a row only', () => {
      const unknown = { kind: 'hcpSomethingNew', summary: 'Something new.', detail: {} }
      const view = hcpApproveView('My helper', read([...hcpEffects(), unknown]), THREAD)
      expect(view.rows).toEqual([...ROWS, 'Something new.'])
      expect(view.notSignIn).toEqual({ key: 'ApproveNotSignIn' })
      expect(hcpText(view.notSignIn.key, 'en')).toBe(NOT_SIGN_IN)
    })

    it('shows it as Keyring’s when an older VTA still sends the retired hcpGrantNotSignIn effect', () => {
      const old = { kind: 'hcpGrantNotSignIn', summary: 'Approving is not signing in.', detail: {} }
      const view = hcpApproveView('My helper', read([...hcpEffects(), old]), THREAD)
      expect(view.notSignIn).toEqual({ key: 'ApproveNotSignIn' })
      // The retired kind is now just an unknown kind: its summary is a row, verbatim.
      expect(view.rows).toEqual([...ROWS, 'Approving is not signing in.'])
    })
  })

  it('takes the title from the name the person gave, never from the request', () => {
    const view = hcpApproveView('My helper', read(), THREAD)
    expect(hcpText(view.title.key, 'en', view.title.params)).toBe('Connect "My helper"?')
    expect(JSON.stringify(view.title)).not.toContain('hcp-cli')
  })

  it('keeps a summary containing markup as the literal text', () => {
    const effects = hcpEffects()
    const markup = 'Run by <script>alert(1)</script> &amp; "Labs".'
    effects[0] = { ...effects[0], summary: markup }
    const view = hcpApproveView('My helper', read(effects), THREAD)
    expect(view.rows[0]).toBe(markup)
    expect(view.rows.slice(1)).toEqual(ROWS.slice(1))
  })

  // control: the rows are the summaries in the request's order, not sorted or rewritten.
  it('keeps the rows in the order of the effects', () => {
    const view = hcpApproveView('My helper', read(), THREAD)
    expect(view.rows).not.toEqual([...ROWS].sort())
    expect(view.rows).toEqual(hcpEffects().map((e) => e.summary))
  })

  it('copies the rows, so changing the view does not change the effects', () => {
    const effects = read()
    const view = hcpApproveView('My helper', effects, THREAD)
    view.rows[0] = 'changed'
    expect(effects.rows[0]).toBe(ROWS[0])
  })
})
