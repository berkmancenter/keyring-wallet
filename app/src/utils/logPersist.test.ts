import { createLogPersist, FLUSH_EVERY_MS, LOG_TAIL_MAX_CHARS, tailWithin } from './logPersist'

function memoryFiles(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    files: {
      exists: jest.fn(async (p: string) => store.has(p)),
      read: jest.fn(async (p: string) => store.get(p) as string),
      write: jest.fn(async (p: string, t: string) => void store.set(p, t)),
      move: jest.fn(async (a: string, b: string) => {
        if (store.has(b)) throw new Error('exists')
        store.set(b, store.get(a) as string)
        store.delete(a)
      }),
      remove: jest.fn(async (p: string) => void store.delete(p)),
    },
  }
}

const CURRENT = 'd/keyring-log-current.txt'
const WRITING = 'd/keyring-log-current.tmp'
const PREVIOUS = 'd/keyring-log-previous.txt'

function persist(opts: { initial?: Record<string, string>; lines?: string[]; now?: () => number } = {}) {
  const mem = memoryFiles(opts.initial)
  let version = 0
  let lines = opts.lines ?? ['a', 'b']
  const p = createLogPersist({
    dir: 'd',
    files: mem.files,
    lines: () => lines,
    version: () => version,
    ...(opts.now ? { now: opts.now } : {}),
  })
  return {
    p,
    ...mem,
    log: (next: string[]) => {
      lines = next
      version++
    },
  }
}

describe('tailWithin', () => {
  it('keeps the newest lines that fit, oldest first', () => {
    expect(tailWithin(['aaaa', 'bb', 'cc'], 6)).toEqual(['bb', 'cc'])
  })

  it('keeps everything that fits', () => {
    expect(tailWithin(['a', 'b'], 100)).toEqual(['a', 'b'])
  })

  it('stops at a line too long to fit, rather than leave a gap in the order', () => {
    expect(tailWithin(['old', 'x'.repeat(50), 'new'], 10)).toEqual(['new'])
  })
})

describe('the log across a kill', () => {
  it('keeps what the last run wrote', async () => {
    const t = persist({ initial: { [CURRENT]: 'last run' } })
    await t.p.start()
    t.p.stop()
    await expect(t.p.previousRun()).resolves.toBe('last run')
    expect(t.store.has(CURRENT)).toBe(false)
  })

  it('a kill while the file was being replaced still leaves the last run', async () => {
    const t = persist({ initial: { [WRITING]: 'nearly' } })
    await t.p.start()
    t.p.stop()
    await expect(t.p.previousRun()).resolves.toBe('nearly')
  })

  it('a good file wins over one half written beside it', async () => {
    const t = persist({ initial: { [CURRENT]: 'good', [WRITING]: 'half' } })
    await t.p.start()
    t.p.stop()
    await expect(t.p.previousRun()).resolves.toBe('good')
  })

  it('replaces an older previous run: only one is kept', async () => {
    const t = persist({ initial: { [CURRENT]: 'newer', [PREVIOUS]: 'older' } })
    await t.p.start()
    t.p.stop()
    await expect(t.p.previousRun()).resolves.toBe('newer')
  })

  it('no last run: none, and no error', async () => {
    const t = persist()
    await t.p.start()
    t.p.stop()
    await expect(t.p.previousRun()).resolves.toBeUndefined()
  })
})

describe('writing it', () => {
  it('writes beside the file and moves it over, so a kill mid-write keeps the last good one', async () => {
    const t = persist({ initial: { [CURRENT]: 'good' } })
    t.log(['new'])
    // A kill mid-write leaves part of a file behind, wherever it was writing.
    t.files.write.mockImplementationOnce(async (path: string) => {
      t.store.set(path, 'half a li')
      throw new Error('killed mid-write')
    })
    await t.p.flush()
    expect(t.store.get(CURRENT)).toBe('good')
    await t.p.flush()
    expect(t.store.get(CURRENT)).toBe('new')
    expect(t.store.has(WRITING)).toBe(false)
  })

  it('writes nothing when nothing was logged', async () => {
    const t = persist()
    await t.p.flush()
    await t.p.flush()
    expect(t.files.write).toHaveBeenCalledTimes(1)
    t.log(['more'])
    await t.p.flush()
    expect(t.files.write).toHaveBeenCalledTimes(2)
  })

  it('never lets two writes overlap', async () => {
    const t = persist()
    let finish: () => void = () => undefined
    t.files.write.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    const first = t.p.flush()
    t.log(['more'])
    await t.p.flush()
    expect(t.files.write).toHaveBeenCalledTimes(1)
    finish()
    await first
  })

  it('is bounded', async () => {
    const t = persist({ lines: Array.from({ length: 5000 }, () => 'x'.repeat(200)) })
    await t.p.flush()
    expect((t.store.get(CURRENT) as string).length).toBeLessThanOrEqual(LOG_TAIL_MAX_CHARS)
  })

  it('a failure never reaches the app', async () => {
    const t = persist()
    t.files.write.mockRejectedValue(new Error('disk full'))
    t.files.exists.mockRejectedValue(new Error('no'))
    await expect(t.p.flush()).resolves.toBeUndefined()
    await expect(t.p.start()).resolves.toBeUndefined()
    t.p.stop()
    await expect(t.p.previousRun()).resolves.toBeUndefined()
  })

  it('writes on a timer once started, not before', async () => {
    jest.useFakeTimers()
    try {
      const t = persist()
      expect(t.files.write).not.toHaveBeenCalled()
      await t.p.start()
      await jest.advanceTimersByTimeAsync(FLUSH_EVERY_MS)
      expect(t.files.write).toHaveBeenCalledTimes(1)
      t.p.stop()
      t.log(['after'])
      await jest.advanceTimersByTimeAsync(FLUSH_EVERY_MS * 3)
      expect(t.files.write).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('reports the slowest JS part, for what it costs on real phones', async () => {
    let clock = 0
    const t = persist({ now: () => (clock += 5) })
    await t.p.flush()
    expect(t.p.slowestJsMs()).toBe(5)
  })
})
