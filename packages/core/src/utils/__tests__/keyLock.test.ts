/**
 * Work in turn, per key: one key's tasks run one after another, in the order asked; other keys and other locks don't
 * wait; and a task that fails leaves the next task for its key to run.
 */
import { createKeyLock } from '../keyLock'

const deferred = <T = void>() => {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

test("one key's tasks run one after another, in the order asked", async () => {
  const inTurn = createKeyLock()
  const started: string[] = []
  const first = deferred()
  const one = inTurn('k', async () => {
    started.push('one')
    await first.promise
    return 1
  })
  const two = inTurn('k', async () => {
    started.push('two')
    return 2
  })
  const three = inTurn('k', async () => {
    started.push('three')
    return 3
  })
  await settle()
  expect(started).toEqual(['one'])

  first.resolve()
  await expect(Promise.all([one, two, three])).resolves.toEqual([1, 2, 3])
  expect(started).toEqual(['one', 'two', 'three'])
})

test("another key doesn't wait, and nor does the same key on another lock", async () => {
  const inTurn = createKeyLock()
  const other = createKeyLock()
  const held = deferred()
  void inTurn('a', () => held.promise)
  const started: string[] = []
  void inTurn('b', async () => void started.push('b on this lock'))
  void other('a', async () => void started.push('a on another lock'))
  await settle()
  expect(started).toEqual(['b on this lock', 'a on another lock'])
  held.resolve()
})

test('a task that fails is its caller’s failure only: the next task for its key still runs', async () => {
  const inTurn = createKeyLock()
  const failing = deferred()
  const one = inTurn('k', () => failing.promise)
  const two = inTurn('k', async () => 'ran')
  failing.reject(new Error('write failed'))
  await expect(one).rejects.toThrow('write failed')
  await expect(two).resolves.toBe('ran')
})

test('a key free again starts its next task at once', async () => {
  const inTurn = createKeyLock()
  await inTurn('k', async () => undefined)
  const started: string[] = []
  void inTurn('k', async () => void started.push('next'))
  await settle()
  expect(started).toEqual(['next'])
})
