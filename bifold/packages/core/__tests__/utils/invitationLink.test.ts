/**
 * The invitation link a person shares, round-tripped through the exact string
 * the share sheet sends, and the same link cut on its way: on build 265 a
 * receiver was handed it cut to 200 characters, and was told "Unable to handle
 * deeplink" (1039) with nothing to do about it.
 */
import { DidCommOutOfBandInvitation } from '@credo-ts/didcomm'

import { domain } from '../../src/constants'
import { invitationLinkError, invitationLinkIncomplete, invitationShareContent } from '../../src/utils/invitationLink'

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
  test.each([
    ['ios', 'url'],
    ['android', 'message'],
  ] as const)(
    'round trip on %s: what is shared is the link alone, as %s, and it carries the invitation',
    (os, field) => {
      const sent = invitation()
      const url = sent.toUrl({ domain })
      const content = invitationShareContent(url, 'Connect', os) as { url?: string; message?: string; title?: string }
      // One item, nothing written around it: a link the receiver taps, not text to select.
      expect(content[field]).toBe(url)
      expect(content[field === 'url' ? 'message' : 'url']).toBeUndefined()
      expect(content.title).toBe('Connect')
      const link = content[field] as string
      expect(invitationLinkIncomplete(link)).toBe(false)
      expect(invitationLinkError(link, t)).toBeUndefined()
      expect(DidCommOutOfBandInvitation.fromUrl(link).toJSON()).toEqual(sent.toJSON())
    }
  )

  test('the same link cut on its way, as a receiver got it, is told as incomplete', () => {
    const url = invitation().toUrl({ domain })
    expect(url.length).toBeGreaterThan(200)
    const cut = url.slice(0, 200)
    // What Credo does with it: the error the receiver hit.
    expect(() => DidCommOutOfBandInvitation.fromUrl(cut)).toThrow()
    expect(invitationLinkIncomplete(cut)).toBe(true)
    const error = invitationLinkError(cut, t)
    expect(error?.code).toBe(1051)
    expect(error?.title).toBe('Error.Title1051')
    expect(error?.description).toBe('Error.Message1051')
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

  // 1050 is BiometryControl's: the invitation's words took it once, and a
  // biometrics failure would have said an invitation link was incomplete.
  test('its code and words are its own: 1051, once per locale, and 1050 left to biometrics', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path')
    for (const f of ['en/en.json', 'fr/fr.json', 'pt-br/pt-br.json']) {
      const raw: string = readFileSync(path.join(__dirname, '../../src/localization', f), 'utf8')
      // A duplicate key still parses, the last one winning; count the raw lines.
      expect(raw.match(/"Title1051":/g)).toHaveLength(1)
      expect(raw.match(/"Message1051":/g)).toHaveLength(1)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const copy = require(`../../src/localization/${f}`).Error
      expect(String(copy.Title1050 ?? '')).not.toMatch(/invitation|invitación|convite|lien/i)
    }
  })

  test('the words say what to do, and claim nothing about why it was cut', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    for (const f of ['en/en.json', 'fr/fr.json', 'pt-br/pt-br.json']) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const copy = require(`../../src/localization/${f}`).Error
      expect(typeof copy.Title1051).toBe('string')
      expect(typeof copy.Message1051).toBe('string')
      expect(copy.Message1051).not.toMatch(/Messages|Signal|WhatsApp|iMessage/)
    }
  })
})
