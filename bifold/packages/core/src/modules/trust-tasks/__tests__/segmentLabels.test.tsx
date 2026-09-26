/**
 * The segments of "Your agent" never wrap a label (IN-37): on 225 the selected
 * "Communities" broke as "Communitie / s" and its pill grew to twice the
 * others. Side by side, each label is one line that may shrink a little;
 * narrow phones and large accessibility text sizes stack the segments, one
 * full-width line each, rather than shrink the text past reading.
 *
 * Jest has no layout engine, so the render tests assert what decides the
 * layout (one line, shrink floor, same pill style for every segment, row or
 * stack); the pixels are the release gate's small-screen pass.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { SEGMENT_MIN_SCALE, labelWidth, segmentLayout } from '../screens/segmentLayout'
import VtaAgentHome, { forgetAgentHoldings } from '../screens/VtaAgentHome'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}))
jest.mock('../module/vtiGrantState', () => ({ ownVetterGrantState: async () => ({ state: 'none' }) }))
// The segment labels as a person reads them, so the layout is judged on real words.
const mockWords: Record<string, string> = {
  'MyAgent.Communities': 'Communities',
  'VtaLink.SegmentManage': 'Manage',
  'VtaLink.SegmentStatus': 'Status',
}
jest.mock('react-i18next', () => {
  const t = (key: string) => mockWords[key] ?? key
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', t, changeLanguage: () => new Promise(() => {}) } }),
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  }
})
const mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 }
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}))

const LABELS = { en: ['Communities', 'Manage', 'Status'], fr: ['Communautés', 'Gérer', 'État'], 'pt-br': ['Comunidades', 'Gerenciar', 'Status'] }
const layout = (width: number, fontScale: number, labels = LABELS.en) =>
  segmentLayout({ width, fontScale, labels, fontSize: 18, chrome: 56, pillPadding: 12 })

describe('segment layout: one line per label, side by side while that reads', () => {
  it.each([
    ['a 6.1" iPhone (393 pt), default text', 'row', 393, 1],
    ['a 6.7" iPhone (430 pt), default text', 'row', 430, 1],
    ['an iPhone SE / mini (375 pt), default text', 'row', 375, 1],
    ['a 320 pt phone, default text', 'stacked', 320, 1],
    ['a 6.1" iPhone, one size larger (xLarge, 1.12)', 'row', 393, 1.12],
    ['a 6.1" iPhone, xxLarge (1.24)', 'stacked', 393, 1.24],
    ['a 6.1" iPhone, the largest accessibility size (3.1)', 'stacked', 393, 3.1],
    ['a 320 pt phone, the largest accessibility size', 'stacked', 320, 3.1],
  ] as const)('%s → %s', (_name, expected, width, fontScale) => {
    expect(layout(width, fontScale)).toBe(expected)
  })

  it('side by side, the widest label fits its pill at no less than the shrink floor, in every language', () => {
    for (const labels of Object.values(LABELS)) {
      for (const [width, fontScale] of [
        [320, 1],
        [375, 1],
        [393, 1],
        [393, 1.24],
        [430, 3.1],
      ]) {
        if (layout(width, fontScale, labels) !== 'row') continue
        const pill = (width - 56) / 3 - 12
        const widest = Math.max(...labels.map((l) => labelWidth(l, 18, fontScale)))
        expect(widest * SEGMENT_MIN_SCALE).toBeLessThanOrEqual(pill)
      }
    }
  })
})

describe('the segments on screen', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    forgetAgentHoldings()
    ;(vtaAgent as unknown as { set(next: Record<string, unknown>): void }).set({
      introSeen: true,
      activity: [],
      approvals: [],
      link: { kind: 'linked', vtaDid: 'did:webvh:example:vta', label: 'bob', linkedAt: '2026-09-22T12:00:00Z', connection: { kind: 'online', since: 0 } },
    })
    ;(useAgent as jest.Mock).mockReturnValue({
      agent: {
        genericRecords: { findAllByQuery: async () => [] },
        config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      },
    })
  })
  afterEach(() => jest.useRealTimers())

  const renderAt = async (width: number, fontScale: number) => {
    Object.assign(mockWindow, { width, fontScale })
    const tree = render(
      <BasicAppContext>
        <VtaAgentHome />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return tree
  }

  const expectOneLineEach = (tree: Awaited<ReturnType<typeof renderAt>>) => {
    for (const key of ['communities', 'manage', 'status']) {
      const label = tree.getByTestId(testIdWithKey(`AgentSegmentLabel_${key}`))
      expect(label.props.numberOfLines).toBe(1)
      expect(label.props.adjustsFontSizeToFit).toBe(true)
      expect(label.props.minimumFontScale).toBe(SEGMENT_MIN_SCALE)
    }
    // Same size for every pill: the selected one differs only in colour.
    const sizeOf = (key: string) => {
      const { backgroundColor: _colour, ...rest } = StyleSheet.flatten(
        tree.getByTestId(testIdWithKey(`AgentSegment_${key}`)).props.style
      )
      return rest
    }
    expect(sizeOf('communities')).toEqual(sizeOf('manage'))
    expect(sizeOf('manage')).toEqual(sizeOf('status'))
  }

  it('a 393 pt phone at the default text size: side by side, one line each', async () => {
    const tree = await renderAt(393, 1)
    expect(StyleSheet.flatten(tree.getByTestId(testIdWithKey('AgentSegments')).props.style).flexDirection).toBe('row')
    expectOneLineEach(tree)
  })

  it('a 320 pt phone at the largest accessibility text size: stacked, one line each', async () => {
    const tree = await renderAt(320, 3.1)
    expect(StyleSheet.flatten(tree.getByTestId(testIdWithKey('AgentSegments')).props.style).flexDirection).toBe(
      'column'
    )
    expectOneLineEach(tree)
  })
})
