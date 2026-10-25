/**
 * "How you know <name>" through real i18next, set up as the app sets it up (default escaping on), not the test mock
 * that returns keys. Two separate things hold: a date reads as the rest of the app writes it ("24 Oct 2026"), and
 * whatever the date or a name holds reads as given, never HTML-escaped ("10&#x2F;24&#x2F;26" for 10/24/26). A
 * month-named date carries nothing the escaping rewrites, so the second is proven with a date that does: localDate is
 * replaced by one that returns it. If the layers ever stop writing dates through localDate, that date never appears
 * and the test fails, rather than passing on a date with nothing to escape.
 */
import { act, render } from '@testing-library/react-native'
import i18next from 'i18next'
import React from 'react'

import RelationshipLayers from '../../../../src/modules/vrc/components/RelationshipLayers'
import { translationResources } from '../../../../src/localization'
import { localDate } from '../../../../src/modules/trust-tasks/screens/localTime'
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
let mockDateShown: string | undefined
jest.mock('../../../../src/modules/trust-tasks/screens/localTime', () => {
  const actual = jest.requireActual('../../../../src/modules/trust-tasks/screens/localTime')
  return { ...actual, localDate: (iso: string) => mockDateShown ?? actual.localDate(iso) }
})

const at = '2026-10-24T12:00:00Z'
const everyKind: RelationshipLayer[] = [
  { kind: 'card', at, hardwareEvidence: false, raw: {} },
  { kind: 'card', at, hardwareEvidence: true, raw: {} },
  { kind: 'witnessed', at, witnessName: 'Wit <Ness>', inPerson: false },
  { kind: 'witnessed', at, inPerson: false },
]

const show = async (name: string, layers: RelationshipLayer[]) => {
  const tree = render(
    <BasicAppContext>
      <RelationshipLayers name={name} layers={layers} />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}

const linesOf = (tree: Awaited<ReturnType<typeof show>>, date: string) => {
  expect(tree.getByText(`Cards exchanged · ${date}`)).toBeTruthy()
  expect(tree.getByText(`Cards exchanged, signed with secure hardware · ${date}`)).toBeTruthy()
  expect(tree.getByText(`Witnessed by Wit <Ness> · ${date}`)).toBeTruthy()
  expect(tree.getByText(`Witnessed · ${date}`)).toBeTruthy()
}

describe('relationship layers, as the person reads them', () => {
  beforeAll(async () => {
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'en', fallbackLng: 'en', resources: translationResources })
    mockT = (key, options) => i18n.t(key, options) as string
  })
  afterEach(() => {
    mockDateShown = undefined
  })

  test('dates read with the month named, as everywhere else in the app', async () => {
    const date = localDate(at)
    // A month named in whatever the runner's locale is ("Oct", "okt.", "10月"), not the numeric short form.
    expect(date).toMatch(/\p{L}/u)
    linesOf(await show('Bob Baker', everyKind), date)
  })

  test('a date or a name with characters the default escaping rewrites reads as given', async () => {
    // Whatever format the date takes later, every line must pass it through untouched; this one would be escaped.
    mockDateShown = "10/24/2026 & 'later'"
    const tree = await show("Bob O'Brien & Co", everyKind)
    const section = tree.getByTestId(testIdWithKey('RelationshipLayers'))
    expect(section).toHaveTextContent("How you know Bob O'Brien & Co", { exact: false })
    linesOf(tree, mockDateShown)
    expect(section).not.toHaveTextContent(/&#|&amp;|&lt;|&gt;|&quot;/)
  })

  test('a layer without a date shows no date', async () => {
    const tree = await show('Bob Baker', [{ kind: 'card', hardwareEvidence: false, raw: {} }])
    expect(tree.getByText(/^Cards exchanged ·\s*$/)).toBeTruthy()
  })
})
