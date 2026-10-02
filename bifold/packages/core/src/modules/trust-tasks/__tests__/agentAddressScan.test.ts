/**
 * "Scan" on Create my agent's address step: what the scanner reads comes back
 * to that screen, not routed as a link. An agent's address, or an agent
 * host's automatic-connection QR, is taken; anything else is said in words
 * and the scanner keeps going.
 */
import { agentAddressScan } from '../module/agentAddressScan'

const VTA = 'did:webvh:QmAgent:dids.ic3.dev:alice-vta'
const hostQr = JSON.stringify({
  vta_did: VTA,
  callback_url: 'https://vtafarm-api.ic3.dev/api/v1/mobile-connections/callback/r.S',
})

afterEach(() => agentAddressScan.cancel())

test('with nobody asking, the scanner routes as usual', () => {
  expect(agentAddressScan.claim(VTA)).toBeUndefined()
})

test("an agent's address is handed back, trimmed, once", () => {
  const got = jest.fn()
  agentAddressScan.request(got)
  expect(agentAddressScan.claim(`  ${VTA}\n`)).toEqual({ taken: true })
  expect(got).toHaveBeenCalledWith({ kind: 'address', vtaDid: VTA })
  expect(agentAddressScan.claim(VTA)).toBeUndefined()
})

test('the scanner is closed before the result is handed over, and exactly once', () => {
  const order: string[] = []
  agentAddressScan.request(() => void order.push('handed over'))
  expect(agentAddressScan.claim(hostQr, () => void order.push('closed'))).toEqual({ taken: true })
  expect(order).toEqual(['closed', 'handed over'])
})

test('a code that is not taken does not close the scanner', () => {
  const close = jest.fn()
  agentAddressScan.request(jest.fn())
  expect(agentAddressScan.claim('did:key:z6MkNewPhone', close)).toEqual({ taken: false, why: 'notAnAgent' })
  expect(close).not.toHaveBeenCalled()
})

test("an agent host's automatic-connection QR is handed back as its offer", () => {
  const got = jest.fn()
  agentAddressScan.request(got)
  expect(agentAddressScan.claim(hostQr)).toEqual({ taken: true })
  expect(got).toHaveBeenCalledWith({
    kind: 'host',
    offer: { vtaDid: VTA, callbackUrl: expect.stringContaining('/callback/'), host: 'vtafarm-api.ic3.dev' },
  })
})

test.each([
  ['a key', 'did:key:z6MkNewPhone', 'notAnAgent'],
  ['a DIDComm invitation', 'https://mediator.example/?oob=eyJ0', 'notAnAgent'],
  [
    'a host QR on another site',
    JSON.stringify({ vta_did: VTA, callback_url: 'https://evil.example/cb' }),
    'hostNotAllowed',
  ],
])('%s is not taken, said why, and the request stays open', (_name, value, why) => {
  const got = jest.fn()
  agentAddressScan.request(got)
  expect(agentAddressScan.claim(value)).toEqual({ taken: false, why })
  expect(got).not.toHaveBeenCalled()
  expect(agentAddressScan.pending()).toBe(true)
})
