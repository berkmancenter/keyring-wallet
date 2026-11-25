/**
 * How a hardware-signed card says its owner unlocked the key. On an iPhone the method is the sending phone's own
 * word (its attestation proves the key, not the unlock), so it reads as reported, never as verified, in every
 * language, through real i18next.
 */
import i18next from 'i18next'

import { translationResources } from '../../../src/localization'
import { attestedMethodLabel } from '../../../src/modules/vrc/utils/attestedMethod'

async function instance(lng: string) {
  const i18n = i18next.createInstance()
  await i18n.init({ lng, fallbackLng: 'en', resources: translationResources })
  return i18n.t.bind(i18n) as typeof i18next.t
}

describe('the unlock method on a hardware-signed card', () => {
  test('English, iPhone: the method as their phone reports it', async () => {
    const t = await instance('en')
    expect(attestedMethodLabel('ios', 'FaceID', t)).toBe(' · Face ID, as reported by their phone')
    expect(attestedMethodLabel('ios', 'DevicePasscode', t)).toBe(' · passcode, as reported by their phone')
  })

  test.each(['en', 'fr', 'pt-BR'])('%s, iPhone: reported, never verified, in its own words', async (lng) => {
    const t = await instance(lng)
    const english = await instance('en')
    for (const method of ['FaceID', 'TouchID', 'Fingerprint', 'DevicePasscode', 'SomethingNew']) {
      const label = attestedMethodLabel('ios', method, t)
      expect(label).not.toMatch(/verif|vérifi|certif|confirm/i)
      expect(label).not.toMatch(/\{\{|&#x|&#\d|undefined|CredentialOffer\./)
      if (lng !== 'en') expect(label).not.toBe(attestedMethodLabel('ios', method, english))
    }
  })

  test('an unknown method is shown as sent, still as reported', async () => {
    const t = await instance('en')
    expect(attestedMethodLabel('ios', 'SomethingNew', t)).toBe(' · SomethingNew, as reported by their phone')
  })

  test('Android and other platforms keep their wording; no method means nothing is added', async () => {
    const t = await instance('en')
    expect(attestedMethodLabel('android', 'Fingerprint', t)).toBe(' via Fingerprint')
    expect(attestedMethodLabel('ios', undefined, t)).toBe('')
    expect(attestedMethodLabel('android', '', t)).toBe('')
  })
})
