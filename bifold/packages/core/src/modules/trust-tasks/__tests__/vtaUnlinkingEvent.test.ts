/**
 * Both unlinks say so before anything of the agent is let go (unlinkEvent): the rooms' kept posts empty on it
 * (rooms/messageCache, messageCacheMatrix.test.ts). This phone's own agent, and another linked one, each by its DID.
 * What either unlink then does is vtaAgentLink.test.ts's; here only the word that goes first.
 */
import { DeviceEventEmitter } from 'react-native'

import { VTA_UNLINKING_EVENT } from '../module/unlinkEvent'
import { vtaAgent, VtaAgentController } from '../module/vtaAgent'

const WORK = 'did:webvh:agent:work'
/** A controller whose look at another agent cannot connect: the unlink goes on at once, not after its deadline. */
function offline(): VtaAgentController {
  const controller = new VtaAgentController()
  controller.configure({
    lookClient: () => ({
      connect: async () => {
        throw new Error('offline')
      },
      disconnect: async () => undefined,
      task: async () => {
        throw new Error('offline')
      },
    }),
    // No agent is kept on this phone: nothing to forget, nothing to list.
    linkStore: () =>
      ({
        get: async () => undefined,
        list: async () => [],
        set: async () => undefined,
        clear: async () => undefined,
        remove: async () => undefined,
      }) as never,
    identityStore: () => ({ forgetManager: async () => undefined }) as never,
  })
  return controller
}

function heard() {
  const said: unknown[] = []
  const sub = DeviceEventEmitter.addListener(VTA_UNLINKING_EVENT, (e) => said.push(e))
  return { said, stop: () => sub.remove() }
}

describe('an unlink says it is unlinking first', () => {
  it("this phone's own agent: said once, before the unlink goes on (with no agent linked, no DID)", async () => {
    const h = heard()
    try {
      await vtaAgent.unlink({} as never).catch(() => undefined)
      expect(h.said).toEqual([{ vtaDid: undefined }])
    } finally {
      h.stop()
    }
  })

  it('another linked agent: said once, with its DID', async () => {
    const h = heard()
    try {
      // Said before its first wait: the unlink's own waits (its telling, its deadline) run on fake time.
      jest.useFakeTimers()
      const unlinking = offline()
        .unlinkAgent({} as never, WORK)
        .catch(() => undefined)
      expect(h.said).toEqual([{ vtaDid: WORK }])
      await jest.runAllTimersAsync()
      await unlinking
      expect(h.said).toEqual([{ vtaDid: WORK }])
    } finally {
      jest.useRealTimers()
      h.stop()
    }
  })

  it('control: nothing is said without an unlink', () => {
    const h = heard()
    try {
      expect(h.said).toEqual([])
    } finally {
      h.stop()
    }
  })
})
