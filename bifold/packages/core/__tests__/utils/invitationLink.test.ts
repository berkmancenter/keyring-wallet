/**
 * The invitation link a person shares, round-tripped through the exact string
 * the share sheet sends, and the same link cut on its way: on build 265 a
 * receiver was handed it cut to 200 characters, and was told "Unable to handle
 * deeplink" (1039) with nothing to do about it.
 */
import { DidCommOutOfBandInvitation } from '@credo-ts/didcomm'

import { domain } from '../../src/constants'
import { invitationLinkError, invitationLinkIncomplete, invitationShareMessage } from '../../src/utils/invitationLink'

const t = ((key: string) => key) as never

const invitation = () =>
  new DidCommOutOfBandInvitation({
    label: 'AL Wallet',
    goalCode: 'relationship.credential.bidirectional',
    goal: 'Establish connection and exchange relationship credentials',
    handshakeProtocols: ['https://didcomm.org/didexchange/1.1' as never],
    services: [
      'did:peer:2.Ez6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECxJ2MwFTFGB.Vz6MkqRYqQiSgvZQdnBytw86Qbs2ZWUkGv22od935YF4s8M7V.SeyJ0IjoiZG0iLCJzIjoiaHR0cHM6Ly9leGFtcGxlLmNvbS9lbmRwb2ludCIsInIiOlsiZGlkOmV4YW1wbGU6c29tZW1lZGlhdG9yI3NvbWVrZXkiXSwiYSI6WyJkaWRjb21tL3YyIiwiZGlkY29tbS9haXAyO2Vudj1yZmM1ODciXX0',
    ],
  })

describe('the invitation link, as it is shared and as it arrives', () => {
  test('round trip: the share message is the link alone, and the link it carries is the invitation', () => {
    const sent = invitation()
    const url = sent.toUrl({ domain })
    const message = invitationShareMessage(url)
    // Nothing before or after it: a messaging app shows a link, ready to tap.
    expect(message).toBe(url)
    expect(invitationLinkIncomplete(message)).toBe(false)
    expect(invitationLinkError(message, t)).toBeUndefined()
    const received = DidCommOutOfBandInvitation.fromUrl(message)
    expect(received.toJSON()).toEqual(sent.toJSON())
  })

  test('the same link cut on its way, as a receiver got it, is told as incomplete', () => {
    const url = invitation().toUrl({ domain })
    expect(url.length).toBeGreaterThan(200)
    const cut = url.slice(0, 200)
    // What Credo does with it: the error the receiver hit.
    expect(() => DidCommOutOfBandInvitation.fromUrl(cut)).toThrow()
    expect(invitationLinkIncomplete(cut)).toBe(true)
    const error = invitationLinkError(cut, t)
    expect(error?.code).toBe(1050)
    expect(error?.title).toBe('Error.Title1050')
    expect(error?.description).toBe('Error.Message1050')
    // Its detail says what was read, never the invitation itself.
    expect(error?.message).not.toContain(cut.slice(60))
  })

  test.each([
    ['keyring://messages'],
    ['https://wallet.asml.berkmancenter.org/invite'],
    ['https://example.org/i/2b7c0f1e?_oobid=2b7c0f1e'],
    ['openid-credential-offer://?credential_offer=%7B%7D'],
  ])('a link that carries no inline invitation is left alone: %s', (link) => {
    expect(invitationLinkIncomplete(link)).toBe(false)
    expect(invitationLinkError(link, t)).toBeUndefined()
  })

  test('the words say what to do, and claim nothing about why it was cut', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    for (const f of ['en/en.json', 'fr/fr.json', 'pt-br/pt-br.json']) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const copy = require(`../../src/localization/${f}`).Error
      expect(typeof copy.Title1050).toBe('string')
      expect(typeof copy.Message1050).toBe('string')
      expect(copy.Message1050).not.toMatch(/Messages|Signal|WhatsApp|iMessage/)
    }
  })
})
