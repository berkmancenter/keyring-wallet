/**
 * A sent draft doesn't come back: the empty field a send leaves is saved at once, and a read of the kept draft that
 * answers after the field was touched is ignored (a slow first read, or a re-read when the agent restarts on lock and
 * unlock). A chat nobody has touched still gets its draft back.
 */
import { act, renderHook } from '@testing-library/react-native'

import { type ChatDraft, DRAFT_SAVE_DELAY_MS, useChatDraft } from '../useChatDraft'

const mockLoad = jest.fn()
const mockSave = jest.fn(async (_agent: unknown, _connectionId: string, _text: string) => undefined)
jest.mock('../draft', () => ({
  loadChatDraft: (...args: unknown[]) => mockLoad(...args),
  saveChatDraft: (...args: [unknown, string, string]) => mockSave(...args),
}))

type FakeAgent = Parameters<typeof useChatDraft>[0]
const newAgent = (): FakeAgent => ({ config: { logger: { warn: jest.fn() } } }) as unknown as FakeAgent
const deferred = () => {
  let resolve: (text: string | undefined) => void = () => undefined
  const promise = new Promise<string | undefined>((r) => (resolve = r))
  return { promise, resolve }
}
const flush = () => act(async () => undefined)

beforeEach(() => {
  jest.useFakeTimers()
  mockLoad.mockReset()
  mockSave.mockClear()
})
afterEach(() => jest.useRealTimers())

test('a send saves the empty field at once; typed text still waits for the pause', async () => {
  mockLoad.mockResolvedValue(undefined)
  const agent = newAgent()
  const { result } = renderHook(() => useChatDraft(agent, 'c1'))
  await flush()
  act(() => result.current.onTextChange('half a thought'))
  act(() => jest.advanceTimersByTime(DRAFT_SAVE_DELAY_MS - 1))
  expect(mockSave).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(1))
  expect(mockSave.mock.calls.map(([, , text]) => text)).toEqual(['half a thought'])

  act(() => result.current.onTextChange(''))
  expect(mockSave.mock.calls.map(([, , text]) => text)).toEqual(['half a thought', ''])
})

test('an untouched chat gets its kept draft back', async () => {
  mockLoad.mockResolvedValue('half a thought')
  const agent = newAgent()
  const { result } = renderHook(() => useChatDraft(agent, 'c1'))
  await flush()
  expect(result.current.saved).toBe('half a thought')
})

// A composer drawn afresh later (a room's, swapped out a while) must not put back words since sent or changed.
test('the draft handed back is spent once the field is touched', async () => {
  mockLoad.mockResolvedValue('half a thought')
  const agent = newAgent()
  const { result } = renderHook(() => useChatDraft(agent, 'c1'))
  await flush()
  expect(result.current.saved).toBe('half a thought')
  act(() => result.current.onTextChange('half a thought, finished'))
  expect(result.current.saved).toBeUndefined()
})

// On main this cleared the kept draft 400 ms after the chat opened, with the draft still on screen.
test("opening a chat keeps its draft: gifted-chat's '' as it lays out the empty field is not a change", async () => {
  const read = deferred()
  mockLoad.mockReturnValue(read.promise)
  const agent = newAgent()
  const { result } = renderHook(() => useChatDraft(agent, 'c1'))
  act(() => result.current.onTextChange(''))
  await act(async () => read.resolve('half a thought'))
  await flush()
  expect(result.current.saved).toBe('half a thought')
  act(() => jest.advanceTimersByTime(DRAFT_SAVE_DELAY_MS * 3))
  expect(mockSave).not.toHaveBeenCalled()
})

test('a first read that answers after a send is ignored', async () => {
  const read = deferred()
  mockLoad.mockReturnValue(read.promise)
  const agent = newAgent()
  const { result } = renderHook(() => useChatDraft(agent, 'c1'))
  // Typed and sent before the first read answers.
  act(() => result.current.onTextChange('on my way'))
  act(() => result.current.onTextChange(''))
  await act(async () => read.resolve('half a thought'))
  await flush()
  expect(result.current.saved).toBeUndefined()
})

test('a re-read when the agent restarts does not bring back a draft already sent', async () => {
  mockLoad.mockResolvedValue('half a thought')
  const { result, rerender } = renderHook<ChatDraft, { agent: FakeAgent }>(({ agent }) => useChatDraft(agent, 'c1'), {
    initialProps: { agent: newAgent() },
  })
  await flush()
  expect(result.current.saved).toBe('half a thought')
  act(() => result.current.onTextChange(''))
  // The restarted agent reads before the cleared draft is gone.
  rerender({ agent: newAgent() })
  await flush()
  expect(mockLoad).toHaveBeenCalledTimes(2)
  expect(result.current.saved).toBeUndefined()
})

test('another chat on the same screen gets its own kept draft, though the last one was touched', async () => {
  mockLoad.mockImplementation(async (_agent: unknown, connectionId: string) => `draft for ${connectionId}`)
  const agent = newAgent()
  const { result, rerender } = renderHook<ChatDraft, { id: string }>(({ id }) => useChatDraft(agent, id), {
    initialProps: { id: 'c1' },
  })
  await flush()
  act(() => result.current.onTextChange('typed'))
  act(() => result.current.onTextChange(''))
  rerender({ id: 'c2' })
  await flush()
  expect(result.current.saved).toBe('draft for c2')
})

// One screen reused for another chat (a deep link or a message wake updates its params) and back again.
test('a chat typed in, then another opened, then the first again: its kept draft comes back', async () => {
  mockLoad.mockImplementation(async (_agent: unknown, connectionId: string) => `draft for ${connectionId}`)
  const agent = newAgent()
  const { result, rerender } = renderHook<ChatDraft, { id: string }>(({ id }) => useChatDraft(agent, id), {
    initialProps: { id: 'c1' },
  })
  await flush()
  act(() => result.current.onTextChange('more words'))
  rerender({ id: 'c2' })
  await flush()
  rerender({ id: 'c1' })
  await flush()
  expect(result.current.saved).toBe('draft for c1')
})
