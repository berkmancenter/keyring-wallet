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
const show = (photo: Known<string | undefined>, extra: { name?: string; fallbackUrl?: string } = {}) =>
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
