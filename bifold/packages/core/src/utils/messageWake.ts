/**
 * A tapped message notification, resolved after the tap.
 *
 * The gateway's message wake carries no content: no sender, no connection, no
 * message id (gateway patch 0003). So which chat it is for can only be learnt
 * once the waiting messages are on the phone. On a tap the app
 *
 * 1. opens the Messages list at once, saying it is fetching new messages, so
 *    nothing on screen is blank while it does;
 * 2. picks up from the mediator now, rather than at the polling loop's next
 *    round (its first round comes one polling interval after a restart);
 * 3. when the first new message or connection request lands, or the pickup
 *    ends, settles where the person is needed, in this order:
 *    - a relationship proposal waits for their consent: stay, and let the
 *      consent sheet (RelationshipProposalModal) show over the list;
 *    - an exchange is signing, witnessing or sending on this phone: stay, so
 *      nothing is pushed over its biometric prompt or witness session;
 *    - someone has just answered one of this phone's invitations (a shared
 *      link opened later): open that new contact's chat, where the exchange
 *      shows its progress;
 *    - otherwise the chat with the newest unread message — the rule the
 *      Messages badge counts by — or the list when nothing is unread.
 *
 * A person who has gone anywhere by then is not moved: the tap brought them to
 * the list, and what they did next wins.
 *
 * @module utils/messageWake
 */
import type { Agent } from '@credo-ts/core'
import { useFocusEffect } from '@react-navigation/native'
import { useCallback } from 'react'
import {
  DidCommBasicMessageEventTypes,
  DidCommBasicMessageRole,
  DidCommConnectionEventTypes,
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
  type DidCommBasicMessageRecord,
  type DidCommBasicMessageStateChangedEvent,
  type DidCommBasicMessageV2StateChangedEvent,
  type DidCommConnectionStateChangedEvent,
} from '@credo-ts/didcomm'

import { isUnreadChatMessage } from '../hooks/useUnreadMessages'
import { vrcFlowStore } from '../modules/vrc/witnessStatusStore'

/** How long a tap waits for the waiting messages before it settles on the list. */
export const MESSAGE_WAKE_WAIT_MS = 8_000
/**
 * How long the tap's own navigation may take to bring the Messages list into
 * focus. A cold start or a return from the background is slower than a warm
 * tap: on an iPhone 11 a busy launch stretched a 1 s wait past its end while
 * the list was already showing (build 265, report VTRM-RFH2).
 */
export const MESSAGE_WAKE_LANDING_MS = 5_000
/** After the pickup has ended with nothing new, how long a message still in processing may take to land. */
export const MESSAGE_WAKE_GRACE_MS = 1_000

/** The connection whose newest unread chat message is the newest of all, if any is unread. */
export function newestUnreadConnection(
  messages: DidCommBasicMessageRecord[],
  isUnread: (message: DidCommBasicMessageRecord) => boolean = isUnreadChatMessage
): string | undefined {
  let newest: DidCommBasicMessageRecord | undefined
  for (const message of messages) {
    if (!isUnread(message)) continue
    if (!newest || new Date(message.createdAt).getTime() > new Date(newest.createdAt).getTime()) newest = message
  }
  return newest?.connectionId
}

// "Fetching new messages", for the Messages list to say while a tap is resolved.
let fetching = false
const listeners = new Set<() => void>()
const setFetching = (next: boolean) => {
  if (fetching === next) return
  fetching = next
  listeners.forEach((listener) => listener())
}
export const messageWakeFetching = {
  get: () => fetching,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

// While a tap is being resolved, the in-app message toast waits: a message
// that lands before the chat opens would otherwise toast for the very chat
// about to open (InAppMessageNotifier shows one unless that chat is active).
// When the tap is resolved, what waited is let through, except for the chat
// it opened.
let holding = false
let held: ((opened: string | undefined) => void)[] = []
export const messageWakeHold = {
  /** Whether a tap is being resolved now. */
  isHolding: () => holding,
  /** Run `then` when the tap is resolved, with the connection whose chat it opened, if any. */
  after: (then: (opened: string | undefined) => void) => {
    if (!holding) then(undefined)
    else held.push(then)
  },
}
const startHold = () => {
  holding = true
}
const releaseHold = (opened: string | undefined) => {
  holding = false
  const waiting = held
  held = []
  waiting.forEach((then) => then(opened))
}

/**
 * Whether the Messages list is in focus, said by the list itself
 * ({@link useReportMessagesListFocus}), the way Chat says which chat is open
 * (activeChatTracker). Not read from navigation state: the app's state is
 * nested under a root stack, and reading it for the focused route answered
 * "not the list" while the list was on screen (VTRM-RFH2).
 */
export interface MessagesListFocus {
  focused(): boolean
  /** How many times the list has lost focus: a change since the tap landed means the person moved. */
  blurs(): number
  subscribe(listener: () => void): () => void
}

let listFocused = false
let listBlurs = 0
const listListeners = new Set<() => void>()
const setListFocused = (next: boolean) => {
  if (listFocused === next) return
  if (!next) listBlurs += 1
  listFocused = next
  listListeners.forEach((listener) => listener())
}
export const messagesListFocus: MessagesListFocus = {
  focused: () => listFocused,
  blurs: () => listBlurs,
  subscribe: (listener) => {
    listListeners.add(listener)
    return () => {
      listListeners.delete(listener)
    }
  },
}

/** Say, from the Messages list, when it has focus and when it loses it. */
export function useReportMessagesListFocus(): void {
  useFocusEffect(
    useCallback(() => {
      setListFocused(true)
      return () => setListFocused(false)
    }, [])
  )
}

export interface MessageWakeDeps {
  /** Show the Messages list. */
  openList(): void
  /** Collect what waits at the mediator now; resolves when that pickup is done. */
  pickUpNow(): Promise<void>
  /** Resolves when the next chat message is received; `cancel` stops listening. */
  nextMessage(): { arrived: Promise<void>; cancel(): void }
  /**
   * Resolves when someone answers one of this phone's invitations; `latest`
   * is the newest such connection seen since this was called.
   */
  nextConnection?(): { arrived: Promise<void>; latest(): string | undefined; cancel(): void }
  /** Whether a relationship proposal is waiting for this person's consent. */
  consentPending?(): boolean
  /** Whether an exchange is doing its own work on this phone (signing, witnessing, sending). */
  exchangeWorking?(): boolean
  /** The connection to open, read once the messages are in. */
  newestUnread(): Promise<string | undefined>
  /** Open that connection's chat. */
  openChat(connectionId: string): void
  /** The Messages list's own report of its focus ({@link messagesListFocus}). */
  listFocus: MessagesListFocus
  log?(message: string, data?: Record<string, unknown>): void
  waitMs?: number
  graceMs?: number
  landingMs?: number
  sleep?(ms: number): Promise<void>
}

export type MessageWakeOutcome = 'chat' | 'newContact' | 'consent' | 'exchange' | 'list' | 'moved' | 'notShown'

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// The tap being resolved now, if any. A second tap while one is under way
// joins it: the messages it is for are the same ones, already on their way,
// and a second run would end the first one's hold on the toasts early.
let inFlight: Promise<MessageWakeOutcome> | undefined

/** Resolve a tapped message notification: see the module's description. */
export function openMessageWake(deps: MessageWakeDeps): Promise<MessageWakeOutcome> {
  if (inFlight) {
    deps.log?.('message wake: a tap is already being resolved; joining it')
    return inFlight
  }
  inFlight = (async () => {
    startHold()
    let opened: string | undefined
    try {
      return await resolveWake(deps, (id) => (opened = id))
    } finally {
      // Together, so no tap can join a run whose hold has already gone.
      inFlight = undefined
      releaseHold(opened)
    }
  })()
  return inFlight
}

/** Resolves true once `focus` says the list has focus, false after `ms`. */
function untilFocused(focus: MessagesListFocus, ms: number, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  if (focus.focused()) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const done = (value: boolean) => {
      if (settled) return
      settled = true
      unsubscribe()
      resolve(value)
    }
    const unsubscribe = focus.subscribe(() => {
      if (focus.focused()) done(true)
    })
    void sleep(ms).then(() => done(focus.focused()))
  })
}

async function resolveWake(deps: MessageWakeDeps, opening: (id: string) => void): Promise<MessageWakeOutcome> {
  const sleep = deps.sleep ?? defaultSleep
  deps.openList()
  setFetching(true)
  // Wait for the list to say it has focus. Only a move the person makes after
  // that counts: the list losing focus again before the messages are in.
  const landed = await untilFocused(deps.listFocus, deps.landingMs ?? MESSAGE_WAKE_LANDING_MS, sleep)
  if (!landed) {
    setFetching(false)
    deps.log?.('message wake: the Messages list never took focus; opening nothing')
    return 'notShown'
  }
  const blursAtLanding = deps.listFocus.blurs()
  const next = deps.nextMessage()
  const connection = deps.nextConnection?.()
  try {
    await Promise.race([
      next.arrived,
      ...(connection ? [connection.arrived] : []),
      deps
        .pickUpNow()
        .catch((error: unknown) => {
          deps.log?.('message wake: pickup failed', { error: error instanceof Error ? error.message : String(error) })
        })
        .then(() => sleep(deps.graceMs ?? MESSAGE_WAKE_GRACE_MS)),
      sleep(deps.waitMs ?? MESSAGE_WAKE_WAIT_MS),
    ])
  } finally {
    next.cancel()
    connection?.cancel()
    setFetching(false)
  }
  if (deps.listFocus.blurs() !== blursAtLanding || !deps.listFocus.focused()) {
    deps.log?.('message wake: the person moved on; staying where they are')
    return 'moved'
  }
  if (deps.consentPending?.()) {
    deps.log?.('message wake: a relationship proposal is waiting for consent; staying on the list')
    return 'consent'
  }
  if (deps.exchangeWorking?.()) {
    deps.log?.('message wake: an exchange is working on this phone; staying on the list')
    return 'exchange'
  }
  const newContact = connection?.latest()
  if (newContact) {
    opening(newContact)
    deps.openChat(newContact)
    return 'newContact'
  }
  const connectionId = await deps.newestUnread().catch(() => undefined)
  if (!connectionId) return 'list'
  opening(connectionId)
  deps.openChat(connectionId)
  return 'chat'
}

/**
 * One pickup from the default mediator, now. The polling loop's first round
 * comes a whole polling interval after it is (re)started, which is the blank
 * a tapped notification showed before.
 */
export async function pickUpNow(agent: Agent, timeoutMs: number = MESSAGE_WAKE_WAIT_MS): Promise<void> {
  const didcomm = (agent.modules as { didcomm?: any }).didcomm
  const mediator = await didcomm?.mediationRecipient?.findDefaultMediator?.()
  if (!mediator || !didcomm?.messagePickup) return
  await didcomm.messagePickup.pickupMessages({
    connectionId: mediator.connectionId,
    // A DIDComm v2 mediator is collected from over Pickup 4.0 (v2Routing.ts).
    protocolVersion: mediator.protocolVersion === 'v2' ? 'v4' : 'v2',
    awaitCompletion: true,
    awaitCompletionTimeoutMs: timeoutMs,
  })
}

/** The next chat message this phone receives, from either DIDComm version. */
export function nextReceivedMessage(agent: Agent): { arrived: Promise<void>; cancel(): void } {
  let cancel = () => undefined as void
  const arrived = new Promise<void>((resolve) => {
    const received = (record: DidCommBasicMessageRecord) => {
      if (record.role === DidCommBasicMessageRole.Receiver && isUnreadChatMessage(record)) resolve()
    }
    // Credo's own event types, one per DIDComm version.
    const v1 = agent.events
      .observable<DidCommBasicMessageStateChangedEvent>(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged)
      .subscribe((event) => received(event.payload.basicMessageRecord))
    const v2 = agent.events
      .observable<DidCommBasicMessageV2StateChangedEvent>(
        DidCommBasicMessageEventTypes.DidCommBasicMessageV2StateChanged
      )
      .subscribe((event) => received(event.payload.basicMessageRecord))
    cancel = () => {
      v1.unsubscribe()
      v2.unsubscribe()
    }
  })
  return { arrived, cancel: () => cancel() }
}

/**
 * The next answer to one of this phone's invitations: a connection on which
 * this phone is the responder (it made the invitation) moving through the DID
 * exchange. A witness connection is not a contact and is left out.
 */
export function nextAnsweredInvitation(agent: Agent): {
  arrived: Promise<void>
  latest(): string | undefined
  cancel(): void
} {
  let latest: string | undefined
  let cancel = () => undefined as void
  const arrived = new Promise<void>((resolve) => {
    const subscription = agent.events
      .observable<DidCommConnectionStateChangedEvent>(DidCommConnectionEventTypes.DidCommConnectionStateChanged)
      .subscribe((event) => {
        const record = event.payload?.connectionRecord
        if (!record || record.role !== DidCommDidExchangeRole.Responder) return
        if (
          record.state !== DidCommDidExchangeState.RequestReceived &&
          record.state !== DidCommDidExchangeState.ResponseSent &&
          record.state !== DidCommDidExchangeState.Completed
        )
          return
        if (record.metadata.get('witnessConnection') != null) return
        latest = record.id
        resolve()
      })
    cancel = () => subscription.unsubscribe()
  })
  return { arrived, latest: () => latest, cancel: () => cancel() }
}

/** The parts of a navigation object the app's wiring uses. */
export interface WakeNavigation {
  navigate(name: string, params?: object): void
}

/**
 * The app's wiring for {@link openMessageWake}, from the main stack's
 * navigation: the Messages tab, a chat the way a contact row opens one
 * (`Stacks.ContactStack` → `Screens.Chat`), and the agent's mediator and
 * messages.
 */
export function appMessageWakeDeps(options: {
  navigation: WakeNavigation
  agent: Agent
  names: { tabStack: string; messageStack: string; contactStack: string; chat: string }
  log?: (message: string, data?: Record<string, unknown>) => void
}): MessageWakeDeps {
  const { navigation, agent, names, log } = options
  return {
    openList: () => navigation.navigate(names.tabStack, { screen: names.messageStack }),
    pickUpNow: () => pickUpNow(agent),
    nextMessage: () => nextReceivedMessage(agent),
    nextConnection: () => nextAnsweredInvitation(agent),
    consentPending: () => vrcFlowStore.getAnyProposalPrompt() !== undefined,
    exchangeWorking: () => vrcFlowStore.isWorkingOnThisPhone(),
    newestUnread: async () => {
      const basicMessages = (agent.modules as { didcomm?: any }).didcomm?.basicMessages
      const records: DidCommBasicMessageRecord[] = (await basicMessages?.findAllByQuery?.({})) ?? []
      return newestUnreadConnection(records)
    },
    openChat: (connectionId) =>
      navigation.navigate(names.contactStack, { screen: names.chat, params: { connectionId } }),
    listFocus: messagesListFocus,
    log,
  }
}
