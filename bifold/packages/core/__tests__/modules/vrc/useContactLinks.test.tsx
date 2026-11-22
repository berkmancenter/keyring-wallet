/**
 * useContactLinks keeps the same map while the stored links say the same thing, so a list that re-reads them on each
 * return neither regroups nor verifies its contacts again; it hands over a new map when a link changes, even one of
 * the same size; and a failed re-read keeps the links it had.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useAgent } from '@bifold/react-hooks'

import { CONTACT_LINK } from '../../../src/modules/vrc/contacts/contactLinks'
import { useContactLinks } from '../../../src/modules/vrc/contacts/useContactLinks'

jest.mock('@bifold/react-hooks')
const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>

const link = (issuerDid: string, contactId: string) => ({
  content: { issuerDid, contactId },
  tags: { recordType: CONTACT_LINK, issuerDid, contactId },
})

describe('useContactLinks', () => {
  let stored: ReturnType<typeof link>[]
  let failing: boolean
  let query: jest.Mock
  beforeEach(() => {
    stored = [link('did:peer:again', 'did:peer:first')]
    failing = false
    query = jest.fn(async () => {
      if (failing) throw new Error('storage unavailable')
      return stored.map((record) => ({ ...record }))
    })
    mockUseAgent.mockReturnValue({
      agent: { config: { logger: { warn: jest.fn() } }, genericRecords: { findAllByQuery: query } },
    } as any)
  })

  test('the same links read again keep the same map; a changed contact, same size, gives a new one', async () => {
    const { result, rerender } = renderHook(({ refresh }) => useContactLinks(refresh), {
      initialProps: { refresh: 0 },
    })
    await waitFor(() => expect(result.current.get('did:peer:again')).toBe('did:peer:first'))
    const first = result.current

    rerender({ refresh: 1 })
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
    // Let the second read's result reach state before comparing (otherwise this passes before it lands).
    await act(async () => {})
    expect(result.current).toBe(first)

    stored = [link('did:peer:again', 'did:peer:other')]
    rerender({ refresh: 2 })
    await waitFor(() => expect(result.current.get('did:peer:again')).toBe('did:peer:other'))
    expect(result.current).not.toBe(first)
  })

  test('a failed re-read keeps the links it had', async () => {
    const { result, rerender } = renderHook(({ refresh }) => useContactLinks(refresh), {
      initialProps: { refresh: 0 },
    })
    await waitFor(() => expect(result.current.size).toBe(1))
    const before = result.current
    failing = true
    rerender({ refresh: 1 })
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(result.current).toBe(before)
  })
})
