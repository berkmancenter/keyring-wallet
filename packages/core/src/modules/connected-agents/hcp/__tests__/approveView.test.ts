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
      approve: { key: 'Approve' },
      clientVid: CLIENT_VID,
      threadId: THREAD,
      expiresAt: GRANT_EXPIRES_AT,
      operator: { id: 'did:web:labs.example', name: 'Example Labs' },
      persistence: 'temporary',
    })
  })

  it('carries a detail grantId when the request sends one, and the term’s persistence as sent', () => {
    const effects = hcpEffects()
    effects[0] = { ...effects[0], detail: { ...(effects[0].detail as object), grantId: GRANT } }
    effects[4] = { ...effects[4], detail: { persistence: 'persistent', expiresAt: GRANT_EXPIRES_AT } }
    const view = hcpApproveView('My helper', read(effects), THREAD)
    expect(view.grantId).toBe(GRANT)
    expect(view.persistence).toBe('persistent')
  })

  it('offers the choose:true purposes as a choice, not as rows, and none is chosen yet', () => {
    const choose = { purpose: 'https://example.org/purpose/research', description: 'research', choose: true }
    const view = hcpApproveView(
      'My helper',
      read([...hcpEffects(), { kind: 'hcpPurpose', summary: 'For research.', detail: choose }]),
      THREAD
    )
    expect(view.rows).toEqual(ROWS)
    expect(view.purposeChoice).toEqual({
      key: 'ApproveChoosePurpose',
      options: [{ purpose: choose.purpose, description: 'research', summary: 'For research.' }],
    })
    expect(view.chosenPurpose).toBeUndefined()
    // control: without one, there is no choice.
    expect(hcpApproveView('My helper', read(), THREAD).purposeChoice).toBeUndefined()
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
