/**
 * "How you know <name>" through real i18next, set up as the app sets it up (default escaping on), not the test mock
 * that returns keys: a date or a name reads as the person typed or the phone formatted it, never HTML-escaped
 * ("10&#x2F;24&#x2F;26" for 10/24/26).
 */
import { act, render } from '@testing-library/react-native'
import i18next from 'i18next'
import React from 'react'

import RelationshipLayers from '../../../../src/modules/vrc/components/RelationshipLayers'
import { translationResources } from '../../../../src/localization'
import type { RelationshipLayer } from '../../../../src/modules/vrc/utils/relationshipLayers'
import { testIdWithKey } from '../../../../src/utils/testable'
import { BasicAppContext } from '../../../helpers/app'

let mockT: (key: string, options?: Record<string, unknown>) => string
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => mockT(key, options) }),
}))
jest.mock('../../../../src/modules/vrc/services/BiometricSignatureVerifier', () => ({
  verifyVrcHardwareEvidence: () => Promise.resolve({ valid: true }),
}))

const at = '2026-10-24T12:00:00Z'
const date = new Date(at).toLocaleDateString()

const show = async (name: string, layers: RelationshipLayer[]) => {
  const tree = render(
    <BasicAppContext>
      <RelationshipLayers name={name} layers={layers} />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}

describe('relationship layers, as the person reads them', () => {
  beforeAll(async () => {
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'en', fallbackLng: 'en', resources: translationResources })
    mockT = (key, options) => i18n.t(key, options) as string
  })

  test('the formatted date has characters the default escaping rewrites', () => {
    // Without a slash (or similar) in the date, the assertions below could not tell escaped from plain text.
    expect(date).toMatch(/[/&<>"']/)
  })

  test('every layer line shows the date as formatted, and the names as given', async () => {
    const tree = await show("Bob O'Brien & Co", [
      { kind: 'card', at, hardwareEvidence: false, raw: {} },
      { kind: 'card', at, hardwareEvidence: true, raw: {} },
      { kind: 'witnessed', at, witnessName: 'Wit <Ness>', inPerson: false },
      { kind: 'witnessed', at, inPerson: false },
    ])
    const section = tree.getByTestId(testIdWithKey('RelationshipLayers'))
    expect(section).toHaveTextContent("How you know Bob O'Brien & Co", { exact: false })
    expect(tree.getByText(`Cards exchanged · ${date}`)).toBeTruthy()
    expect(tree.getByText(`Cards exchanged, signed with secure hardware · ${date}`)).toBeTruthy()
    expect(tree.getByText(`Witnessed by Wit <Ness> · ${date}`)).toBeTruthy()
    expect(tree.getByText(`Witnessed · ${date}`)).toBeTruthy()
    expect(section).not.toHaveTextContent(/&#|&amp;|&lt;|&gt;|&quot;/)
  })
})
