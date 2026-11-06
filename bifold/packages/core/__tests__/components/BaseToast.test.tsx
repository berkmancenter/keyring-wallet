import { render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'

import BaseToast, { ToastType } from '../../src/components/toast/BaseToast'
import { testIdWithKey } from '../../src/utils/testable'

describe('BaseToast Component', () => {
  test('Info renders correctly', () => {
    const tree = render(
      <BaseToast
        title={'Hello World'}
        body={'The quick brown fox jumped over the lazy dog'}
        toastType={ToastType.Info}
      />
    )

    expect(tree).toMatchSnapshot()
  })

  test('Success renders correctly', () => {
    const tree = render(
      <BaseToast
        title={'Hello World'}
        body={'The quick brown fox jumped over the lazy dog'}
        toastType={ToastType.Success}
      />
    )

    expect(tree).toMatchSnapshot()
  })

  test('Warn renders correctly', () => {
    const tree = render(
      <BaseToast
        title={'Hello World'}
        body={'The quick brown fox jumped over the lazy dog'}
        toastType={ToastType.Warn}
      />
    )

    expect(tree).toMatchSnapshot()
  })

  test('Error renders correctly', () => {
    const tree = render(
      <BaseToast
        title={'Hello World'}
        body={'The quick brown fox jumped over the lazy dog'}
        toastType={ToastType.Error}
      />
    )

    expect(tree).toMatchSnapshot()
  })

  test('Toast Renders without body text', () => {
    const tree = render(<BaseToast title={'Hello World'} toastType={ToastType.Error} />)
    const bodyText = tree.queryByTestId('ToastBody')
    expect(bodyText).toBeNull()
  })
})

describe('BaseToast over the screen', () => {
  const flat = (style: unknown) =>
    (StyleSheet.flatten(style as never) ?? {}) as { borderWidth?: unknown; backgroundColor?: unknown }
  // The tinted box is the title's nearest host ancestor with a border; the next host view behind it with a background
  // must be opaque. Host views only: a component's own instance carries the same style as the view it renders.
  type Node = { type: unknown; props: { style?: unknown }; parent: Node | null }
  const host = (node: Node | null) => !!node && typeof node.type === 'string'
  const behindTint = (toastType: ToastType) => {
    const tree = render(<BaseToast title={'Hello World'} toastType={toastType} />)
    let node = tree.getByTestId(testIdWithKey('ToastTitle')).parent as Node | null
    while (node && !(host(node) && flat(node.props.style).borderWidth !== undefined)) node = node.parent
    expect(node).toBeTruthy()
    let below = node?.parent ?? null
    while (below && !(host(below) && flat(below.props.style).backgroundColor !== undefined)) below = below.parent
    return { tint: flat(node?.props.style).backgroundColor, base: flat(below?.props.style).backgroundColor }
  }
  const opaque = (color: unknown) =>
    typeof color === 'string' && !/^rgba\(.*,\s*(0?\.\d+|0)\s*\)$/i.test(color) && color !== 'transparent'

  test.each([ToastType.Warn, ToastType.Info, ToastType.Success, ToastType.Error])(
    '%s: the tint sits on an opaque base, so nothing behind the toast shows through',
    (toastType) => {
      const { tint, base } = behindTint(toastType)
      expect(tint).toBeTruthy()
      expect(opaque(base)).toBe(true)
    }
  )

  test('the check tells a translucent tint from an opaque one (control)', () => {
    expect(opaque('rgba(239, 178, 67, 0.35)')).toBe(false)
    expect(opaque('#FFFFFF')).toBe(true)
  })
})
