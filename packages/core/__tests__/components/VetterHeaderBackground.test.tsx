/**
 * The vetter's header: the theme's gradient with its far end changed, so the
 * vetter's desk and the applicant's side of vetting read differently at a
 * glance (Alberto, 10-06). The header draws it only when a screen asks.
 */
import { render } from '@testing-library/react-native'
import React from 'react'
import { Stop } from 'react-native-svg'

import { BasicAppContext } from '../helpers/app'
import HeaderWithBanner from '../../src/components/views/HeaderWithBanner'
import { VETTER_HEADER, VetterHeaderBackground } from '../../src/components/views/VetterHeaderBackground'
import { bifoldTheme, ColorPalette } from '../../src/theme'

jest.mock('@react-navigation/stack', () => ({ Header: () => null }))

describe('the vetter header', () => {
  it("keeps the theme's gradient and changes only its far end, to the focus colour", () => {
    const tree = render(
      <BasicAppContext>
        <VetterHeaderBackground />
      </BasicAppContext>
    )
    const stops = tree.UNSAFE_getAllByType(Stop).map((s) => s.props.stopColor)
    const usual = bifoldTheme.GradientTheme!.headerGradient.colors
    expect(stops).toHaveLength(usual.length)
    expect(stops.slice(0, -1)).toEqual(usual.slice(0, -1))
    expect(stops[stops.length - 1]).toBe(ColorPalette.semantic.focus)
  })

  it('is drawn by the header only when the screen asks for it', () => {
    const props = (headerVariant?: string) =>
      ({ options: { headerVariant }, route: {}, navigation: {}, layout: {}, progress: {} }) as never
    const asked = render(
      <BasicAppContext>
        <HeaderWithBanner {...props(VETTER_HEADER)} />
      </BasicAppContext>
    )
    expect(asked.getByTestId('VetterHeaderBackground')).toBeTruthy()
    const usual = render(
      <BasicAppContext>
        <HeaderWithBanner {...props()} />
      </BasicAppContext>
    )
    expect(usual.queryByTestId('VetterHeaderBackground')).toBeNull()
  })
})
