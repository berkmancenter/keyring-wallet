import enWords from '../localization/en'
import frWords from '../localization/fr'
import ptBrWords from '../localization/pt-br'

import { initFailureShown, initFailureWords, messageServiceUnreachable } from './initFailure'

/** The chain a tester's phone showed on first run while the hosted mediator was down (IN-75). */
const didcommTimedOut = () => {
  const timeout = new Error('Timeout has occurred')
  timeout.name = 'TimeoutError'
  const credo = new Error(
    "Error during call to 'onInitializeContext' method in module 'didcomm' for agent context 'default'.",
    { cause: timeout }
  )
  credo.name = 'CredoError'
  return new Error(
    "Error during call to 'onInitializeContext' method in module 'didcomm' for agent context 'default'.",
    {
      cause: credo,
    }
  )
}

describe('the message service did not answer', () => {
  it('is recognised from the didcomm start-up step timing out', () => {
    expect(messageServiceUnreachable(didcommTimedOut())).toBe(true)
  })

  it.each([
    'Network request failed',
    'fetch failed',
    'connect ECONNREFUSED 10.0.0.1:443',
    'WebSocket closed before the connection was established',
    'getaddrinfo ENOTFOUND mediator.example',
  ])('and from the same step failing on the network: %s', (reason) => {
    const error = new Error("Error during call to 'onInitializeContext' method in module 'didcomm'", {
      cause: new Error(reason),
    })
    expect(messageServiceUnreachable(error)).toBe(true)
  })

  it('is not claimed for a didcomm start-up failure of another kind', () => {
    const error = new Error("Error during call to 'onInitializeContext' method in module 'didcomm'", {
      cause: new TypeError('undefined is not a function'),
    })
    expect(messageServiceUnreachable(error)).toBe(false)
  })

  it('nor for a timeout somewhere else in start-up', () => {
    const timeout = new Error('Timeout has occurred')
    timeout.name = 'TimeoutError'
    expect(messageServiceUnreachable(new Error('Could not open the wallet', { cause: timeout }))).toBe(false)
    expect(messageServiceUnreachable(timeout)).toBe(false)
  })

  it('nor for something that is not an error', () => {
    expect(messageServiceUnreachable(undefined)).toBe(false)
    expect(messageServiceUnreachable('Timeout has occurred')).toBe(false)
  })

  it('a chain that loops is read once, not for ever', () => {
    const a = new Error("Error during call to 'onInitializeContext' method in module 'didcomm'") as Error & {
      cause?: unknown
    }
    a.cause = a
    expect(messageServiceUnreachable(a)).toBe(false)
  })
})

describe('what the start-up error card says', () => {
  it('the message service: its own words, and no raw text on the card', () => {
    expect(initFailureWords(didcommTimedOut())).toEqual({
      title: 'Init.MessageServiceTitle',
      description: 'Init.MessageServiceBody',
      showRawText: false,
    })
  })

  it('anything else: the general words, with the text one tap away, as before', () => {
    expect(initFailureWords(new Error('boom'))).toEqual({
      title: 'Error.Title2026',
      description: 'Error.Message2026',
      showRawText: true,
    })
  })

  it("the problem report is given the words the card showed, not the error's own description", () => {
    const t = (key: string) =>
      key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], enWords) as string
    expect(initFailureShown(initFailureWords(didcommTimedOut()), t)).toBe(
      "Keyring couldn't reach its message service. Your wallet and everything in it are fine. The service that carries Keyring's messages didn't answer. Check that this phone is online, then try again. If it is, the service may be down for a while."
    )
    expect(initFailureShown(initFailureWords(new Error('boom')), t)).toBe(
      'Oops! Something went wrong. The app has encountered a problem. Try restarting the app.'
    )
  })

  it('the words exist in every language, name the service plainly and blame nobody', () => {
    for (const words of [enWords, frWords, ptBrWords]) {
      const init = (words as unknown as { Init: Record<string, string> }).Init
      expect(init.MessageServiceTitle).toEqual(expect.any(String))
      expect(init.MessageServiceBody).toEqual(expect.any(String))
      expect(`${init.MessageServiceTitle} ${init.MessageServiceBody}`).not.toMatch(
        /didcomm|mediator|onInitializeContext|timeout|\(FR\)|\(PT-BR\)/i
      )
    }
    const en = (enWords as unknown as { Init: Record<string, string> }).Init
    expect(en.MessageServiceBody).toMatch(/wallet/i)
    expect(en.MessageServiceBody).toMatch(/try again/i)
  })
})
