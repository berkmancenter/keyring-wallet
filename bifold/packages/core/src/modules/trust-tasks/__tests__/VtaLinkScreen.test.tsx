/**
 * Link your agent — the success screen is shown once. Continue sets the stack
 * to My Agent → Your agent instead of pushing on top of it, so a return to the
 * tab does not bring "Linked ✓" back.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import VtaLink from '../screens/VtaLink'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Setter = { set(next: Record<string, unknown>): void }

describe('Link your agent — done', () => {
  test('Continue leaves My Agent → Your agent, with the success screen gone', async () => {
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue({ agent: {} })
    const controller = vtaAgent as unknown as Setter
    controller.set({
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:vta',
        label: 'alice',
        linkedAt: '2026-09-22T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
    const navigation = useNavigation() as unknown as { reset: jest.Mock; navigate: jest.Mock }
    navigation.reset.mockClear()
    navigation.navigate.mockClear()
    const tree = render(
      <BasicAppContext>
        <VtaLink />
      </BasicAppContext>
    )
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkContinue')))
    })
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 1,
      routes: [{ name: Screens.MyAgent }, { name: Screens.VtaAgent }],
    })
    expect(navigation.navigate).not.toHaveBeenCalledWith(Screens.VtaAgent)
  })
})
