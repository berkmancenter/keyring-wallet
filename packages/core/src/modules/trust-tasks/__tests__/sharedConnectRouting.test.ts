/** A shared-connect link through the scanner's router (plan WP1): behind the developer flag, to its own screen. */
import { Screens } from '../../../types/navigators'
import { setSharedConnectEnabled } from '../module/sharedConnectFlag'
import {
  keyringAgentLinkKind,
  linkForLog,
  MY_AGENT_SCREEN,
  myAgentLinkParams,
  routeKeyringAgentLink,
} from '../module/vtiLinks'

import { sharedConnectLink } from './fixtures/sharedConnectFixtures'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const live = () => sharedConnectLink({ exp: Math.floor(Date.now() / 1000) + 300 })

afterEach(() => setSharedConnectEnabled(false))

describe('a shared-connect link', () => {
  it('is a trigger link either way', () => {
    expect(keyringAgentLinkKind(live())).toBe('triggerLink')
  })

  it('is answered "needs a newer version" with the flag off, and nothing is navigated or resolved', async () => {
    const navigate = jest.fn()
    const resolve = jest.fn()
    await expect(routeKeyringAgentLink(live(), { dids: { resolve } } as never, navigate)).rejects.toMatchObject({
      messageKey: 'Scan.TriggerLinkUpdate',
    })
    expect(navigate).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  describe('with the flag on', () => {
    beforeEach(() => setSharedConnectEnabled(true))

    it('opens the confirm screen carrying the link, and sends nothing', async () => {
      const link = live()
      const navigate = jest.fn()
      const resolve = jest.fn()
      await routeKeyringAgentLink(`  ${link}\n`, { dids: { resolve } } as never, navigate)
      expect(navigate).toHaveBeenCalledWith({ screen: 'SharedConnect', link, scanId: expect.any(String) })
      const [destination] = navigate.mock.calls[0]
      expect(MY_AGENT_SCREEN.SharedConnect).toBe(Screens.SharedConnect)
      expect(myAgentLinkParams(destination)).toEqual({
        screen: Screens.SharedConnect,
        initial: false,
        params: { link, scanId: destination.scanId },
      })
      expect(resolve).not.toHaveBeenCalled()
    })

    it.each([
      ['an expired code', sharedConnectLink({ exp: 1000 }), 'Scan.TriggerLinkExpired'],
      [
        'a numalgo-0 contact',
        sharedConnectLink({
          from: 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
          exp: Math.floor(Date.now() / 1000) + 300,
        }),
        'Scan.TriggerLinkUpdate',
      ],
      [
        'a did:web contact',
        sharedConnectLink({ from: 'did:web:example.org', exp: Math.floor(Date.now() / 1000) + 300 }),
        'Scan.TriggerLinkInvalid',
      ],
    ])('says why for %s, and navigates nowhere', async (_, link, messageKey) => {
      const navigate = jest.fn()
      await expect(routeKeyringAgentLink(link, {} as never, navigate)).rejects.toMatchObject({ messageKey })
      expect(navigate).not.toHaveBeenCalled()
    })
  })
})

describe('the deep-link log line (WP12)', () => {
  const SENTINEL = 'Zq-label-sentinel-7781'

  it('names a trigger link by kind and length only: never its label, handle or contact', () => {
    const link = sharedConnectLink({ exp: Math.floor(Date.now() / 1000) + 300, label: SENTINEL })
    const fragment = new URLSearchParams(link.slice(link.indexOf('#') + 1))
    const line = linkForLog(` ${link}\n`)
    expect(line).toBe(`trigger link (${[...link].length} chars)`)
    for (const secret of [SENTINEL, fragment.get('_id') as string, (fragment.get('_from') as string).slice(0, 30)]) {
      expect(line).not.toContain(secret)
    }
  })

  it('leaves any other link as it was', () => {
    expect(linkForLog('https://example.org/oob?c_i=abc')).toBe('https://example.org/oob?c_i=abc')
    expect(linkForLog('keyring://messages')).toBe('keyring://messages')
  })
})
