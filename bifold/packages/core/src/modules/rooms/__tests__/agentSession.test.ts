/**
 * Whether the agent is being reached again: a session opening (the unlock's reopen behind a link shown online), or a
 * link connecting or reconnecting. Not when it is offline after its retries, gone, or not linked: a failed read says so then.
 */
import { agentReconnecting } from '../agentSession'
import type { VtaConnection, VtaLinkState } from '../../trust-tasks/module/vtaLinkMachine'

const linked = (connection: VtaConnection): VtaLinkState =>
  ({ kind: 'linked', vtaDid: 'did:webvh:vta', label: 'Agent', connection }) as VtaLinkState

describe('agentReconnecting', () => {
  test.each([
    ['a session opening behind a link shown online (an unlock)', linked({ kind: 'online' }), true, true],
    ['connecting at start-up', linked({ kind: 'connecting', since: 0 }), undefined, true],
    ['reconnecting after a drop', linked({ kind: 'reconnecting', attempt: 1, nextRetryAt: 0, since: 0 }), false, true],
    ['online, no session opening', linked({ kind: 'online' }), false, false],
    ['offline after its retries', linked({ kind: 'offline', since: 0 }), false, false],
    ['gone', linked({ kind: 'gone', since: 0, why: 'notFound' } as VtaConnection), false, false],
    ['not linked, even with a session opening', { kind: 'notLinked' } as VtaLinkState, true, false],
  ])('%s', (_, link, sessionOpening, expected) => {
    expect(agentReconnecting({ link, sessionOpening })).toBe(expected)
  })
})
