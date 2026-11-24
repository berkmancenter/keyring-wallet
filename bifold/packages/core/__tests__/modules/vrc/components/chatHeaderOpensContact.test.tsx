/**
 * The chat header's photo and name open the contact page (Alberto's hand run of 278.18, 2026-11-13: he could only get
 * there through ⋯ › View Contact). Both ways go through useChatContact, so they open the same page with the same
 * contact; with no relationship on this connection, neither is offered.
 */
import { useAgent } from '@bifold/react-hooks'
import * as navigationNative from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import ChatHeaderTitle from '../../../../src/modules/vrc/components/ChatHeaderTitle'
import InfoIcon from '../../../../src/modules/vrc/components/InfoIcon'
import { Screens, Stacks } from '../../../../src/types/navigators'
import { testIdWithKey } from '../../../../src/utils/testable'
import { BasicAppContext } from '../../../helpers/app'

jest.mock('@react-navigation/elements', () => {
  const { Text } = jest.requireActual('react-native')
  return { HeaderTitle: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text> }
})
jest.mock('../../../../src/modules/vrc/contacts/useContactFacts', () => ({
  ...jest.requireActual('../../../../src/modules/vrc/contacts/useContactFacts'),
  useConnectionFacts: () => ({ name: { known: true, value: 'Jordan' }, photo: { known: false } }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nativeMethods = require('react-native/jest/MockNativeMethods').default
const id = (key: string) => testIdWithKey(key)
const CONN = 'conn-jordan'
const JORDAN = 'did:peer:2.jordan'
const getAll = jest.fn()
// The shared navigation mock hands every caller the same navigation object, so its navigate is the one pressed.
const navigate = (navigationNative.useNavigation() as unknown as { navigate: jest.Mock }).navigate

const relationships = (records: { connectionId: string; counterpartyRelationshipDid?: string }[]) => {
  getAll.mockResolvedValue(records)
  ;(useAgent as jest.Mock).mockReturnValue({
    agent: { context: {}, dependencyManager: { resolve: () => ({ getAll }) } },
  })
}
const show = async (node: React.ReactElement) => {
  const tree = render(<BasicAppContext>{node}</BasicAppContext>)
  await act(async () => undefined)
  return tree
}

beforeEach(() => {
  navigate.mockClear()
  nativeMethods.measureInWindow.mockImplementation((answer: (x: number, y: number, w: number, h: number) => void) =>
    answer(300, 40, 44, 44)
  )
})

describe('the chat header opens the contact page', () => {
  test('tapping the photo and name opens their contact page, the same one as ⋯ › View Contact', async () => {
    relationships([{ connectionId: CONN, counterpartyRelationshipDid: JORDAN }])
    const header = await show(<ChatHeaderTitle connectionId={CONN} label="Jordan" />)
    const button = header.getByTestId(id('ChatHeaderViewContact'))
    expect(button.props.accessibilityRole).toBe('button')
    expect(button.props.accessibilityLabel).toBe('Jordan')
    expect(button.props.accessibilityHint).toBe('ContactDetails.ViewContact')
    fireEvent.press(button)
    expect(navigate).toHaveBeenCalledTimes(1)
    const [stack, target] = navigate.mock.calls[0]
    expect(stack).toBe(Stacks.ContactStack)
    expect(target.screen).toBe(Screens.ContactDetails)
    expect(target.params.contact.issuer.id).toBe(JORDAN)
    header.unmount()

    // Control: the ⋯ menu's View Contact goes to exactly the same place.
    const menu = await show(<InfoIcon connectionId={CONN} />)
    fireEvent.press(menu.getByTestId(id('ContactMenu')))
    fireEvent.press(menu.getByTestId(id('ContactMenuViewContact')))
    expect(navigate).toHaveBeenCalledTimes(2)
    expect(navigate.mock.calls[1]).toEqual(navigate.mock.calls[0])
  })

  test('no relationship on this connection: the title is plain text and the menu has no View Contact (control: above)', async () => {
    relationships([{ connectionId: 'someone-else', counterpartyRelationshipDid: JORDAN }])
    const header = await show(<ChatHeaderTitle connectionId={CONN} label="Jordan" />)
    expect(header.queryByTestId(id('ChatHeaderViewContact'))).toBeNull()
    expect(header.getByTestId(id('ChatHeaderTitle'))).toBeTruthy()
    expect(header.getByText('Jordan')).toBeTruthy()
    header.unmount()
    const menu = await show(<InfoIcon connectionId={CONN} />)
    fireEvent.press(menu.getByTestId(id('ContactMenu')))
    expect(menu.getByTestId(id('ContactMenuDisappearing'))).toBeTruthy()
    expect(menu.queryByTestId(id('ContactMenuViewContact'))).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })
})
