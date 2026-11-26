/**
 * A contact's photo in a circle: their card's photo; else the connection's own image, inset whole; else their
 * initial; else a person icon. Nothing at all while what is known of them has not been read yet.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import ContactPhoto from '../../../../src/modules/vrc/components/ContactPhoto'
import type { Known } from '../../../../src/modules/vrc/contacts/useContactFacts'
import { testIdWithKey } from '../../../../src/utils/testable'
import { BasicAppContext } from '../../../helpers/app'

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')

const id = testIdWithKey
const NOT_READ: Known<string | undefined> = { known: false }
const NONE: Known<string | undefined> = { known: true, value: undefined }
const PHOTO: Known<string | undefined> = { known: true, value: 'data:image/jpeg;base64,AAAA' }
const show = (
  photo: Known<string | undefined>,
  extra: { name?: string; fallbackUrl?: string; initials?: 1 | 2; muted?: boolean } = {}
) =>
  render(
    <BasicAppContext>
      <ContactPhoto photo={photo} size={50} {...extra} />
    </BasicAppContext>
  )

describe('a contact’s photo', () => {
  test('their card’s photo, filling the circle, before any other picture of them', () => {
    const tree = show(PHOTO, { name: 'Alice', fallbackUrl: 'https://example.org/logo.png' })
    const image = tree.getByTestId(id('ContactPhotoImage'))
    expect(image.props.source).toEqual({ uri: PHOTO.known && PHOTO.value })
    expect(image.props.resizeMode).toBe('cover')
    expect(tree.queryByTestId(id('ContactPhotoLogo'))).toBeNull()
    expect(tree.queryByTestId(id('ContactPhotoInitial'))).toBeNull()
  })

  test('no photo on their card: the connection’s own image, inset whole, as the chat list showed it', () => {
    const tree = show(NONE, { name: 'Alice', fallbackUrl: 'https://example.org/logo.png' })
    const logo = tree.getByTestId(id('ContactPhotoLogo'))
    expect(logo.props.source).toEqual({ uri: 'https://example.org/logo.png' })
    expect(logo.props.resizeMode).toBe('contain')
    expect(tree.queryByTestId(id('ContactPhotoImage'))).toBeNull()
  })

  test('no picture of them at all: their initial, else a person icon', () => {
    expect(show(NONE, { name: ' alice' }).getByTestId(id('ContactPhotoInitial'))).toHaveTextContent('A')
    const nameless = show(NONE)
    expect(nameless.queryByTestId(id('ContactPhotoInitial'))).toBeNull()
    expect(nameless.UNSAFE_getByType('Icon' as never)).toBeTruthy()
  })

  test('not read yet: an empty circle, no initial to be replaced a moment later by their photo', () => {
    const tree = show(NOT_READ, { name: 'Alice', fallbackUrl: 'https://example.org/logo.png' })
    expect(tree.getByTestId(id('ContactPhoto'))).toBeTruthy()
    expect(tree.queryByTestId(id('ContactPhotoImage'))).toBeNull()
    expect(tree.queryByTestId(id('ContactPhotoLogo'))).toBeNull()
    expect(tree.queryByTestId(id('ContactPhotoInitial'))).toBeNull()
  })
})

// The Messages list (L2): initials on a muted tone of their own, white, instead of one letter on the plain circle.
describe('initials on a muted tone', () => {
  const circleOf = (tree: ReturnType<typeof show>) =>
    Object.assign({}, ...[tree.getByTestId(id('ContactPhoto')).props.style].flat(Infinity).filter(Boolean))

  test('two words: their first and last initials; one word: its first letter', () => {
    expect(show(NONE, { name: 'Sam Okafor', initials: 2 }).getByTestId(id('ContactPhotoInitial'))).toHaveTextContent(
      'SO'
    )
    expect(
      show(NONE, { name: 'Ana Maria Ribeiro', initials: 2 }).getByTestId(id('ContactPhotoInitial'))
    ).toHaveTextContent('AR')
    expect(show(NONE, { name: 'Lena', initials: 2 }).getByTestId(id('ContactPhotoInitial'))).toHaveTextContent('L')
  })

  test('muted: a tone of their own behind white letters, the same tone every time', () => {
    const first = circleOf(show(NONE, { name: 'Sam Okafor', initials: 2, muted: true }))
    const again = circleOf(show(NONE, { name: 'Sam Okafor', initials: 2, muted: true }))
    expect(first.backgroundColor).toMatch(/^#[0-9A-F]{6}$/i)
    expect(again.backgroundColor).toBe(first.backgroundColor)
  })

  test('as before unless asked: one letter, no tone (Contacts keeps its look)', () => {
    const tree = show(NONE, { name: 'Sam Okafor' })
    expect(tree.getByTestId(id('ContactPhotoInitial'))).toHaveTextContent('S')
    expect(circleOf(tree).backgroundColor).toBeUndefined()
  })

  test('never over a photo or a logo', () => {
    expect(circleOf(show(PHOTO, { name: 'Sam Okafor', initials: 2, muted: true })).backgroundColor).toBeUndefined()
    expect(
      circleOf(show(NONE, { name: 'Sam Okafor', fallbackUrl: 'https://example.org/l.png', initials: 2, muted: true }))
        .backgroundColor
    ).toBeUndefined()
  })
})
