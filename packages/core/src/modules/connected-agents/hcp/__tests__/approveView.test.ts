/**
 * The approve view: Keyring's own copy keys around the VTA's five summaries, which are kept verbatim and in order.
 */
import { readHcpEffects, type HcpEffects } from '../approvals'
import { hcpApproveView } from '../approveView'
import { hcpText } from '../copy'
import { CLIENT_VID, GRANT, hcpApproval, hcpEffects, ROWS, THREAD } from './fixtures/hcpApproval'

jest.mock('../../../trust-tasks/module/vtaAgent', () => ({ vtaAgent: {} }))

function read(effects = hcpEffects()): HcpEffects {
  const read = readHcpEffects(hcpApproval({ effects }))
  if (!read) throw new Error('fixture not read')
  return read
}

describe('hcpApproveView', () => {
  it('is the copy keys, the rows and what the record needs', () => {
    expect(hcpApproveView('My helper', read())).toEqual({
      title: { key: 'ApproveTitle', params: { name: 'My helper' } },
      rows: ROWS,
      warning: { key: 'ApproveOwnTerminal' },
      approve: { key: 'Approve' },
      clientVid: CLIENT_VID,
      grantId: GRANT,
      threadId: THREAD,
      expiresInSeconds: 14400,
    })
  })

  it('takes the title from the name the person gave, never from the request', () => {
    const view = hcpApproveView('My helper', read())
    expect(hcpText(view.title.key, 'en', view.title.params)).toBe('Connect "My helper"?')
    expect(JSON.stringify(view.title)).not.toContain('hcp-cli')
  })

  it('keeps a summary containing markup as the literal text', () => {
    const effects = hcpEffects()
    const markup = 'Run by <script>alert(1)</script> &amp; "Labs".'
    effects[0] = { ...effects[0], summary: markup }
    const view = hcpApproveView('My helper', read(effects))
    expect(view.rows[0]).toBe(markup)
    expect(view.rows.slice(1)).toEqual(ROWS.slice(1))
  })

  // control: the rows are the summaries in the request's order, not sorted or rewritten.
  it('keeps the rows in the order of the effects', () => {
    const view = hcpApproveView('My helper', read())
    expect(view.rows).not.toEqual([...ROWS].sort())
    expect(view.rows).toEqual(hcpEffects().map((e) => e.summary))
  })

  it('copies the rows, so changing the view does not change the effects', () => {
    const effects = read()
    const view = hcpApproveView('My helper', effects)
    view.rows[0] = 'changed'
    expect(effects.rows[0]).toBe(ROWS[0])
  })
})
