/**
 * The credential registry's hooks read it during render (UI-smoothness plan, Phase 5). Each copied the registry
 * into state from an effect, so a screen's first frame had no Revoked mark and no notifications, and they arrived
 * a frame later. A flag also outlived its credential: with no credential, the last one's Revoked stayed.
 *
 * Every committed frame's value is kept in order (a layout effect runs once per commit).
 */
import { act, renderHook } from '@testing-library/react-native'
import React, { useLayoutEffect } from 'react'

import { BasicAppContext } from '../../helpers/app'
import { useCredentialErrorsFromRegistry } from '../../../src/modules/openid/hooks/useCredentialErrorsFromRegistry'
import { useExpiredNotifications } from '../../../src/modules/openid/hooks/useExpiredNotifications'
import {
  resetReplacementFirstSeen,
  useReplacementNotifications,
} from '../../../src/modules/openid/hooks/useReplacementNotifications'
import { credentialRegistry } from '../../../src/modules/openid/refresh/registry'
import { CredentialErrors } from '../../../src/types/credentials'

/** `use`, with what every committed frame returned. */
function frames<T>(use: () => T) {
  const seen: T[] = []
  const hook = renderHook(
    () => {
      const value = use()
      useLayoutEffect(() => {
        seen.push(value)
      })
      return value
    },
    { wrapper: ({ children }: React.PropsWithChildren) => <BasicAppContext>{children}</BasicAppContext> }
  )
  return { ...hook, seen }
}

const card = (id: string) => ({ id }) as never

beforeEach(() => {
  credentialRegistry.getState().reset()
  resetReplacementFirstSeen()
})

describe('Revoked, from the registry', () => {
  test('a credential the registry has flagged is Revoked in the first frame', () => {
    credentialRegistry.setState({ expired: ['cred-1'] })
    const { seen } = frames(() => useCredentialErrorsFromRegistry(card('cred-1')))
    expect(seen[0]).toEqual([CredentialErrors.Revoked])
    expect(seen.every((errors) => errors.includes(CredentialErrors.Revoked))).toBe(true)
  })

  test('a flag that arrives later shows in the next frame, and one for another credential never shows', () => {
    const { seen, rerender } = frames(() => useCredentialErrorsFromRegistry(card('cred-1')))
    expect(seen[0]).toEqual([])
    act(() => credentialRegistry.setState({ expired: ['cred-2'] }))
    rerender({})
    expect(seen[seen.length - 1]).toEqual([])
    act(() => credentialRegistry.setState({ expired: ['cred-1'] }))
    expect(seen[seen.length - 1]).toEqual([CredentialErrors.Revoked])
  })

  test('with no credential, the last one’s flag does not stay', () => {
    credentialRegistry.setState({ expired: ['cred-1'] })
    let credential: never | undefined = card('cred-1')
    const { seen, rerender } = frames(() => useCredentialErrorsFromRegistry(credential))
    expect(seen[0]).toEqual([CredentialErrors.Revoked])
    credential = undefined
    rerender({})
    expect(seen[seen.length - 1]).toEqual([])
  })
})

describe('notifications, from the registry', () => {
  test('an expired credential the registry has checked is listed in the first frame, and once read, not again', () => {
    credentialRegistry.setState({ expired: ['cred-1'], checked: ['cred-1'] })
    const { seen } = frames(() => useExpiredNotifications())
    expect(seen[0].map((n) => n.metadata?.oldId)).toEqual(['cred-1'])
    // The list keeps its identity between renders: a consumer's effect on it does not run for nothing.
    expect(seen).toHaveLength(1)
  })

  test('a replacement is listed in the first frame, and keeps its first-seen time across a rebuild', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-10-25T12:00:00Z'))
    credentialRegistry.setState({ expired: ['cred-1'], replacements: { 'cred-1': { id: 'cred-2' } as never } })
    const { seen } = frames(() => useReplacementNotifications())
    expect(seen[0].map((n) => n.metadata?.oldId)).toEqual(['cred-1'])
    const first = seen[0][0].createdAt?.getTime()
    // A minute later the registry changes and the list is built again: the replacement was first seen then, not now.
    jest.setSystemTime(new Date('2026-10-25T12:01:00Z'))
    act(() => credentialRegistry.setState({ checked: ['cred-1'] }))
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[seen.length - 1][0].createdAt?.getTime()).toBe(first)
    jest.useRealTimers()
  })
})
