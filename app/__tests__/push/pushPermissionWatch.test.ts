/**
 * Notifications blocked in the phone's own Settings while Keyring's switch is
 * on: the agent's wake channel follows the permission (push/pushPermissionWatch.ts).
 */
import {
  DENIAL_CONFIRM_GAP_MS,
  reconcilePushPermission,
  watchPushPermission,
  type AppStateSource,
  type OsPermission,
  type PermissionWatchDeps,
} from '@/push/pushPermissionWatch'
import type { PushWakeOutcome } from '@/push/pushWake'

const wakeable = { status: 'wakeable', handle: { gateway: 'did:web:gw', handle: 'h' } } as PushWakeOutcome

function deps(over: { optedIn?: boolean; linked?: boolean; permission?: OsPermission; cleared?: boolean } = {}) {
  let cleared = over.cleared ?? false
  const d = {
    optedIn: jest.fn(() => over.optedIn ?? true),
    linked: jest.fn(() => over.linked ?? true),
    permission: jest.fn(async () => over.permission ?? 'granted'),
    clearedForDenial: {
      get: jest.fn(async () => cleared),
      set: jest.fn(async (v: boolean) => {
        cleared = v
      }),
    },
    clearWake: jest.fn(async () => ({ pushCapable: false })),
    enableWake: jest.fn(async () => wakeable),
    log: jest.fn(),
  }
  return { d: d as PermissionWatchDeps & typeof d, cleared: () => cleared }
}

describe('notifications blocked in the phone settings', () => {
  it('clears the wake channel once, and remembers why', async () => {
    const { d, cleared } = deps({ permission: 'denied' })
    await expect(reconcilePushPermission(d)).resolves.toBe('cleared')
    expect(d.clearWake).toHaveBeenCalledTimes(1)
    expect(cleared()).toBe(true)

    await expect(reconcilePushPermission(d)).resolves.toBe('none')
    expect(d.clearWake).toHaveBeenCalledTimes(1)
  })

  it('does nothing while Keyring is not linked to an agent', async () => {
    const { d } = deps({ permission: 'denied', linked: false })
    await expect(reconcilePushPermission(d)).resolves.toBe('none')
    expect(d.clearWake).not.toHaveBeenCalled()
  })

  it('tries again at the next check when the agent could not be told', async () => {
    const { d, cleared } = deps({ permission: 'denied' })
    d.clearWake.mockRejectedValueOnce(new Error('agent unreachable'))
    await expect(reconcilePushPermission(d)).resolves.toBe('failed')
    expect(cleared()).toBe(false)
    await expect(reconcilePushPermission(d)).resolves.toBe('cleared')
  })
})

describe('notifications allowed again', () => {
  it('makes the phone wakeable again after a clear for denial', async () => {
    const { d, cleared } = deps({ permission: 'granted', cleared: true })
    await expect(reconcilePushPermission(d)).resolves.toBe('restored')
    expect(d.enableWake).toHaveBeenCalledTimes(1)
    expect(cleared()).toBe(false)
  })

  it('leaves a phone that was never cleared alone, so it is not registered at every start', async () => {
    const { d } = deps({ permission: 'granted' })
    await expect(reconcilePushPermission(d)).resolves.toBe('none')
    expect(d.enableWake).not.toHaveBeenCalled()
    expect(d.clearWake).not.toHaveBeenCalled()
  })

  it('keeps trying while Apple has no token yet', async () => {
    const { d, cleared } = deps({ permission: 'granted', cleared: true })
    d.enableWake.mockResolvedValueOnce({ status: 'noToken' })
    await expect(reconcilePushPermission(d)).resolves.toBe('failed')
    expect(cleared()).toBe(true)
  })
})

describe("Keyring's own switch", () => {
  it('switched off: nothing is done, and a remembered clear is forgotten', async () => {
    const { d, cleared } = deps({ optedIn: false, permission: 'denied', cleared: true })
    await expect(reconcilePushPermission(d)).resolves.toBe('none')
    expect(d.clearWake).not.toHaveBeenCalled()
    expect(d.enableWake).not.toHaveBeenCalled()
    expect(cleared()).toBe(false)
  })

  it('a permission never asked for (Android before the prompt) changes nothing', async () => {
    const { d } = deps({ permission: 'unknown', cleared: true })
    await expect(reconcilePushPermission(d)).resolves.toBe('none')
    expect(d.enableWake).not.toHaveBeenCalled()
  })
})

function fakeAppState() {
  let listener: ((s: string) => void) | undefined
  const remove = jest.fn()
  const source: AppStateSource = {
    addEventListener: (_type, l) => {
      listener = l
      return { remove }
    },
  }
  return { source, emit: (s: string) => listener?.(s), remove }
}

describe('when the check runs', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve))

  it('at start, and each time the app comes back to the foreground', async () => {
    const { d } = deps()
    const app = fakeAppState()
    const stop = watchPushPermission(d, app.source)
    await flush()
    expect(d.permission).toHaveBeenCalledTimes(1)

    app.emit('background')
    await flush()
    expect(d.permission).toHaveBeenCalledTimes(1)

    app.emit('active')
    await flush()
    expect(d.permission).toHaveBeenCalledTimes(2)

    stop()
    expect(app.remove).toHaveBeenCalled()
  })

  it('a storage failure is logged, not thrown', async () => {
    const { d } = deps()
    d.clearedForDenial.get.mockRejectedValueOnce(new Error('storage'))
    watchPushPermission(d, fakeAppState().source)
    await flush()
    expect(d.log).toHaveBeenCalledWith('push wake: permission check failed', { error: 'storage' })
  })
})

describe('when the agent link comes up', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve))

  it('checks again at link-up, and a block seen there is cleared at a later check past the gap (Android cold start, 10-04)', async () => {
    let linked = false
    let clock = 1_000_000
    const listeners = new Set<() => void>()
    const app = fakeAppState()
    const { d } = deps({ permission: 'denied' })
    d.linked.mockImplementation(() => linked)
    d.now = () => clock
    const stop = watchPushPermission(d, app.source, (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    })
    await flush()
    expect(d.permission).not.toHaveBeenCalled() // not linked: no reading, no mark

    linked = true
    listeners.forEach((l) => l())
    await flush()
    expect(d.permission).toHaveBeenCalledTimes(1)
    expect(d.clearWake).not.toHaveBeenCalled()

    // Other changes while it stays up do not check again.
    listeners.forEach((l) => l())
    await flush()
    expect(d.permission).toHaveBeenCalledTimes(1)

    clock += DENIAL_CONFIRM_GAP_MS
    app.emit('active')
    await flush()
    expect(d.clearWake).toHaveBeenCalledTimes(1)
    expect(d.log).toHaveBeenCalledWith('push wake: cleared, notifications blocked in the phone settings', {
      confirmedAt: 'foreground',
      firstSeenAt: 'link-up',
      apartMs: DENIAL_CONFIRM_GAP_MS,
    })

    stop()
    expect(listeners.size).toBe(0)
  })
})

// GS-1, 10-06: on build 238 the link-up after a cold start read "denied" once
// and cleared a wake channel set a second earlier, with nobody touching a
// setting. One reading, or two in the same start-up burst, must not clear.
describe('a denied reading is confirmed by a later check before anything is cleared', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve))
  function watch(reads: OsPermission[]) {
    let linked = false
    let clock = 1_000_000
    const listeners = new Set<() => void>()
    const app = fakeAppState()
    const { d, cleared } = deps()
    d.permission.mockImplementation(async () => reads.shift() ?? 'granted')
    d.linked.mockImplementation(() => linked)
    d.now = () => clock
    watchPushPermission(d, app.source, (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    })
    const linkUp = async () => {
      linked = true
      listeners.forEach((l) => l())
      await flush()
    }
    const foreground = async (afterMs: number) => {
      clock += afterMs
      app.emit('active')
      await flush()
    }
    return { d, cleared, linkUp, foreground }
  }

  it('the 238 shape: denied once at link-up, then granted: nothing cleared', async () => {
    const w = watch(['denied', 'granted'])
    await flush()
    await w.linkUp()
    expect(w.d.log).toHaveBeenCalledWith('push wake: denied, waiting for a later check before clearing', {
      at: 'link-up',
      firstSeenAt: 'link-up',
    })
    await w.foreground(60_000)
    expect(w.d.clearWake).not.toHaveBeenCalled()
    expect(w.cleared()).toBe(false)
  })

  it('a burst: denied at link-up and again 200 ms later: nothing cleared', async () => {
    const w = watch(['denied', 'denied'])
    await flush()
    await w.linkUp()
    await w.foreground(200)
    expect(w.d.permission).toHaveBeenCalledTimes(2)
    expect(w.d.clearWake).not.toHaveBeenCalled()
  })

  it('a granted reading in between resets the mark', async () => {
    const w = watch(['denied', 'granted', 'denied'])
    await flush()
    await w.linkUp()
    await w.foreground(DENIAL_CONFIRM_GAP_MS)
    await w.foreground(DENIAL_CONFIRM_GAP_MS)
    expect(w.d.clearWake).not.toHaveBeenCalled()
  })

  it('a real block: denied at two checks the gap apart: cleared once', async () => {
    const w = watch(['denied', 'denied', 'denied'])
    await flush()
    await w.linkUp()
    await w.foreground(DENIAL_CONFIRM_GAP_MS)
    await w.foreground(DENIAL_CONFIRM_GAP_MS)
    expect(w.d.clearWake).toHaveBeenCalledTimes(1)
    expect(w.cleared()).toBe(true)
  })
})
