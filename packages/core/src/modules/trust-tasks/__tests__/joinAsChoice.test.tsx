/**
 * Which profile a Join as step has chosen, derived in render (UI-smoothness plan, Phase 5). It was copied into state
 * by an effect that also re-ran on every render (the options were a new list each time): a deleted chosen profile
 * left nothing chosen, and the first frame after profiles arrived had none.
 */
import { act, renderHook } from '@testing-library/react-native'
import { useLayoutEffect } from 'react'

import { useJoinAsChoice, useJoinAsOptions } from '../screens/JoinAs'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Profile = { id: string; name: string }
let mockState: { rCard?: { profiles?: Profile[]; activeProfileId?: string } } = {}
jest.mock('../../../contexts/store', () => ({
  ...jest.requireActual('../../../contexts/store'),
  useStore: () => [mockState, jest.fn()],
}))
jest.mock('../../vrc/types/rcard', () => ({
  ...jest.requireActual('../../vrc/types/rcard'),
  formInputFromTemplate: (p: Profile) => ({ firstName: p.name, lastName: '', label: p.id }),
}))

const navigation = { navigate: jest.fn() }
const profiles = (...ids: string[]) => ids.map((id) => ({ id, name: `Name ${id}` }))

/** The choice, with what every committed frame had chosen. */
const choice = () => {
  const seen: (string | undefined)[] = []
  const hook = renderHook(() => {
    const value = useJoinAsChoice(navigation)
    useLayoutEffect(() => {
      seen.push(value.selectedId)
    })
    return value
  })
  return { ...hook, seen }
}

beforeEach(() => {
  mockState = {}
  navigation.navigate.mockReset()
})

test('the options are the same list until the profiles change', () => {
  mockState = { rCard: { profiles: profiles('a', 'b'), activeProfileId: 'b' } }
  const hook = renderHook(() => useJoinAsOptions())
  const first = hook.result.current.options
  hook.rerender({})
  expect(hook.result.current.options).toBe(first)
  expect(first.map((o) => o.id)).toEqual(['b', 'a'])
})

test('the default is chosen in the first frame, not a frame later', () => {
  mockState = { rCard: { profiles: profiles('a', 'b'), activeProfileId: 'b' } }
  const { seen } = choice()
  expect(seen[0]).toBe('b')
})

test('a chosen profile that is deleted gives way to the default, never to nothing', () => {
  mockState = { rCard: { profiles: profiles('a', 'b'), activeProfileId: 'a' } }
  const { result, rerender } = choice()
  act(() => result.current.setSelectedId('b'))
  expect(result.current.selectedId).toBe('b')
  mockState = { rCard: { profiles: profiles('a'), activeProfileId: 'a' } }
  rerender({})
  expect(result.current.selectedId).toBe('a')
  expect(result.current.selected?.id).toBe('a')
})

test('a profile created from "new profile" is chosen when the person comes back, and a later pick wins', () => {
  mockState = { rCard: { profiles: profiles('a'), activeProfileId: 'a' } }
  const { result, rerender } = choice()
  act(() => result.current.createProfile())
  expect(navigation.navigate).toHaveBeenCalled()
  mockState = { rCard: { profiles: profiles('a', 'new'), activeProfileId: 'a' } }
  rerender({})
  expect(result.current.selectedId).toBe('new')
  act(() => result.current.setSelectedId('a'))
  expect(result.current.selectedId).toBe('a')
})
