/**
 * Manage → "Bring back your communities and cards from your agent" (226,
 * agent-kept cards; 242): first take on the agent's community identities this
 * phone does not hold yet (vtiAdoptIdentities), then fetch the cards the agent
 * keeps for every identity and keep them on this phone again — after a
 * reinstall, on a new phone, or any time a card went missing here.
 *
 * Offered whenever an agent is linked, a new phone with no identity included.
 * Identities are taken on only here, when the person asks: never at link.
 *
 * @module trust-tasks/screens/GetCardsFromAgent
 */

import type { Agent } from '@credo-ts/core'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, DeviceEventEmitter, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { emitCommunityChanged, VTI_PERSONA_KEYS_HELD_EVENT } from '../module/communityChanged'
import { vtaAgent } from '../module/vtaAgent'
import {
  adoptAgentIdentities,
  keyIdsFromDocument,
  visibleContextsOf,
  type AdoptionReport,
} from '../module/vtiAdoptIdentities'
import {
  cardsOnPhone,
  fetchAgentCards,
  recoverCardsFromAgent,
  type AgentCard,
  type RecoveredRefusal,
  type VaultTask,
} from '../module/vtiCardVault'
import { sameIdentity } from '../module/didScid'
import { forgetRoomCommunities } from '../module/roomCards'
import { checkDeliveredCard } from '../module/vtiDeliveredCheck'
import { classifyCredential } from '../module/vtiInbox'
import { GenericRecordsCommunityStore, type VtiCommunityStore } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'

export interface CardsBack {
  found: number
  restored: number
  /** Cards this phone already held: not saved again. */
  already?: number
  refused: RecoveredRefusal[]
  /** Identities whose agent did not answer. */
  unreachable: number
  /** Communities whose identity this phone took on from its agent first. */
  adopted?: number
  /** Identities asked, those taken on included. */
  asked?: number
  /** The identities taken on, for the next run to ask again without taking them on twice. */
  taken?: VtiPersona[]
  /**
   * Why no community came back, when none did and the agent answered: it showed this phone no identity it does
   * not hold already (`noOtherIdentities`), or it holds no community card for those it showed (`noCards`), or its
   * only community cards are for the agent itself (`agentItself`), which is never one of this phone's identities.
   */
  noneBecause?: 'noOtherIdentities' | 'noCards' | 'agentItself'
  /** The agent contexts this phone's grant lets it see, when it is not unrestricted. */
  visibleContexts?: string[]
  /** Identities with a community card whose DID document could not be read: not taken on. */
  unreadableIdentities?: number
}

/** How far a run has got: cards found and kept, and while the agent's cards are being read, how many are read. */
export type CardsProgress = { found: number; restored: number; read?: number }

/** What taking on the agent's identities found, with what the phone can see of it. */
export type AdoptionFound = AdoptionReport & { visibleContexts?: string[] }

export interface GetCardsDeps {
  recover: typeof recoverCardsFromAgent
  store: (agent: Agent) => VtiCommunityStore
  /** The agent, connected, as a task sender. */
  taskFor: (agent: Agent, vtaDid: string) => Promise<VaultTask>
  /**
   * Every card the agent keeps, each fetched once; `onRead` hears how many are read of how many, and a card in
   * `onPhone` is not fetched.
   */
  fetchCards: (
    task: VaultTask,
    onRead?: (read: number, of: number) => void,
    onPhone?: ReadonlyMap<string, Record<string, unknown>>
  ) => Promise<AgentCard[]>
  /** Take on the agent's identities this phone does not hold yet (`held`: the DIDs it does), from its `cards`. */
  adopt: (agent: Agent, vtaDid: string, held: string[], cards: AgentCard[]) => Promise<AdoptionFound>
  /** Forget the data rooms an earlier Bring back recorded as communities, found among `cards`; answers their DIDs. */
  forgetRooms?: (agent: Agent, cards: AgentCard[]) => Promise<string[]>
}

const defaultDeps: GetCardsDeps = {
  recover: recoverCardsFromAgent,
  store: (agent) => new GenericRecordsCommunityStore(agent),
  taskFor: async (agent, vtaDid) => {
    await vtaAgent.connect(agent, vtaDid)
    const client = vtaAgent.client(agent, vtaDid)
    return <T,>(type: string, payload: Record<string, unknown>) => client.task<T>(type, payload)
  },
  fetchCards: fetchAgentCards,
  adopt: async (agent, vtaDid, held, cards) => {
    await vtaAgent.connect(agent, vtaDid)
    const client = vtaAgent.client(agent, vtaDid)
    const report = await adoptAgentIdentities({
      identities: new GenericRecordsIdentityStore(agent),
      vtaDid,
      cards,
      check: (credential, issuer) => checkDeliveredCard(agent, credential, issuer),
      listDids: () => client.listDids(),
      keyIdsOf: async (did) => {
        const { didDocument } = await agent.dids.resolve(did)
        return keyIdsFromDocument(did, didDocument as unknown as Record<string, unknown> | undefined)
      },
      held,
      // An identity taken on has no key copies on the phone yet: without them it cannot reach its community.
      holdKeys: async (persona) => {
        await client.holdPersonaKeys(persona)
        DeviceEventEmitter.emit(VTI_PERSONA_KEYS_HELD_EVENT, { did: persona.did })
      },
      onKeysFailed: (persona, reason) =>
        agent.config.logger.warn(
          `Bring back: ${persona.did}'s keys were not borrowed; asked again when a session with its agent next opens: ${reason}`
        ),
    })
    // What this phone's grant lets it see, for saying why nothing came back; a phone that cannot tell says less.
    const me = await client.whoAmI().catch(() => undefined)
    return { ...report, visibleContexts: visibleContextsOf(me?.scopes) }
  },
  forgetRooms: (agent, cards) =>
    forgetRoomCommunities({
      cards,
      communities: new GenericRecordsCommunityStore(agent),
      identities: new GenericRecordsIdentityStore(agent),
    }),
}

/**
 * The whole of "Bring back": the agent's identities this phone lacks are taken
 * on first (an agent that does not answer takes nothing on, and the cards of
 * the identities already here are still fetched), then every identity's cards.
 */
export async function bringBackFromAgent(
  agent: Agent,
  vtaDid: string | undefined,
  personas: VtiPersona[],
  onProgress: (p: CardsProgress) => void,
  deps: GetCardsDeps = defaultDeps
): Promise<CardsBack> {
  const read = vaultReader(agent, deps, (r, of) => onProgress({ found: of, restored: 0, read: r }))
  let silent = false
  const vault = vtaDid ? await read(vtaDid) : undefined
  // A room an earlier Bring back took for a community is forgotten first, so nothing below asks it as one.
  const rooms = new Set((vault && (await deps.forgetRooms?.(agent, vault.cards).catch((): string[] => []))) || [])
  const kept = rooms.size > 0 ? personas.filter((p) => !rooms.has(p.communityDid)) : personas
  const found =
    vtaDid && vault
      ? await deps
          .adopt(
            agent,
            vtaDid,
            kept.filter((p) => p.vtaDid === vtaDid).map((p) => p.did),
            vault.cards
          )
          .catch(() => undefined)
      : undefined
  if (vtaDid && !found) silent = true
  const adopted = found?.adopted ?? []
  const held = new Set(kept.map((p) => `${p.vtaDid}|${p.communityDid}`))
  const fresh = adopted.filter((p) => !held.has(`${p.vtaDid}|${p.communityDid}`))
  const all = [...kept, ...fresh]
  // Nothing on this phone, and the agent did not answer: said as unreachable, not "no cards".
  if (silent && all.length === 0)
    return { found: 0, restored: 0, refused: [], unreachable: 1, adopted: 0, asked: 1, taken: [] }
  for (const p of fresh) emitCommunityChanged(p.communityDid, 'membership')
  const got = await getCardsFromAgent(agent, all, onProgress, deps, read, found?.failedCheck)
  const noneBecause =
    !found || fresh.length > 0 || found.unreadable.length > 0
      ? undefined
      : // A card for the agent itself is not taken on (agentOwnIdentity): said so, not "no other identities".
        (found.cardsForAgent ?? 0) > 0 && found.cardsForOthers === 0
        ? 'agentItself'
        : found.otherIdentities === 0
          ? 'noOtherIdentities'
          : found.cardsForOthers === 0
            ? 'noCards'
            : undefined
  return {
    ...got,
    adopted: fresh.length,
    asked: all.length,
    taken: fresh,
    ...(noneBecause ? { noneBecause } : {}),
    ...(found?.visibleContexts ? { visibleContexts: found.visibleContexts } : {}),
    ...(found?.unreadable.length ? { unreadableIdentities: found.unreadable.length } : {}),
  }
}

type VaultRead = { task: VaultTask; cards: AgentCard[] }

/** Each agent's vault, read once per run however many identities it holds; undefined when it does not answer. */
function vaultReader(
  agent: Agent,
  deps: GetCardsDeps,
  onRead?: (read: number, of: number) => void
): (vtaDid: string) => Promise<VaultRead | undefined> {
  const reads = new Map<string, Promise<VaultRead | undefined>>()
  // The cards already on this phone, read once a run: the vault is not asked for them again.
  let onPhone: Promise<Map<string, Record<string, unknown>>> | undefined
  return (vtaDid) => {
    let read = reads.get(vtaDid)
    if (!read) {
      read = (async () => {
        const task = await deps.taskFor(agent, vtaDid)
        onPhone ??= cardsOnPhone(deps.store(agent)).catch(() => new Map())
        return { task, cards: await deps.fetchCards(task, onRead, await onPhone) }
      })().catch(() => undefined)
      reads.set(vtaDid, read)
    }
    return read
  }
}

/**
 * Every identity on this phone, one after another (the agent answers one task
 * at a time); a count across all of them as it goes. Each agent's vault is
 * read once and each card goes to the identity it is about; a card about none
 * of them is counted once. An agent that does not answer counts each of its
 * identities, and the others still run. `failedCheck`: cards adoption already
 * found do not hold up, counted as such rather than as another identity's.
 */
export async function getCardsFromAgent(
  agent: Agent,
  personas: VtiPersona[],
  onProgress: (p: CardsProgress) => void,
  deps: GetCardsDeps = defaultDeps,
  read: (vtaDid: string) => Promise<VaultRead | undefined> = vaultReader(agent, deps, (r, of) =>
    onProgress({ found: of, restored: 0, read: r })
  ),
  failedCheck: { credentialId: string; communityDid: string }[] = []
): Promise<CardsBack> {
  const store = deps.store(agent)
  const total: CardsBack = { found: 0, restored: 0, refused: [], unreachable: 0 }
  const failed = new Set(failedCheck.map((f) => f.credentialId))
  const byAgent = new Map<string, VtiPersona[]>()
  for (const p of personas) byAgent.set(p.vtaDid, [...(byAgent.get(p.vtaDid) ?? []), p])
  for (const [vtaDid, theirs] of byAgent) {
    const vault = await read(vtaDid)
    if (!vault) {
      total.unreachable += theirs.length
      continue
    }
    total.found += vault.cards.length
    onProgress({ found: total.found, restored: total.restored })
    const mine = new Map<string, AgentCard[]>()
    for (const card of vault.cards) {
      const subject = card.credential ? classifyCredential(card.credential).subjectDid : undefined
      // Whose card it is: the identity's DID, or its did:scid:vh:1 form (didScid).
      const whose = subject ? theirs.find((p) => sameIdentity(p.did, subject))?.did : undefined
      if (whose) mine.set(whose, [...(mine.get(whose) ?? []), card])
      else if (!card.credential) total.refused.push({ credentialId: card.id, reason: 'unreadable' })
      else if (failed.has(card.id)) {
        const f = failedCheck.find((x) => x.credentialId === card.id)
        total.refused.push({ credentialId: card.id, communityDid: f?.communityDid, reason: 'failedCheck' })
      } else total.refused.push({ credentialId: card.id, reason: 'notOurs' })
    }
    for (const persona of theirs) {
      const before = total.restored
      try {
        const got = await deps.recover(agent, store, persona, vault.task, {
          cards: mine.get(persona.did) ?? [],
          onProgress: (p) => onProgress({ found: total.found, restored: before + p.restored }),
        })
        total.restored += got.restored.length
        if (got.already.length) total.already = (total.already ?? 0) + got.already.length
        total.refused.push(...got.refused)
        if (got.restored.length) emitCommunityChanged(persona.communityDid, 'membership')
      } catch {
        total.unreachable += 1
      }
    }
  }
  return total
}

/** Why a card was not kept, in words (the vault module gives codes). */
export const REFUSED_WORDS: Record<RecoveredRefusal['reason'], string> = {
  failedCheck: 'VtaLink.CardsBackFailedCheck',
  notOurs: 'VtaLink.CardsBackNotOurs',
  unreadable: 'VtaLink.CardsBackUnreadable',
}

/**
 * The run in progress, app-wide. The screen opened again while one runs
 * follows its count and shows its result, rather than starting a second run
 * that reads the vault alongside it (#401 Farm run: a tap made after leaving
 * and coming back overlapped the first).
 */
type Run = {
  progress: CardsProgress
  listeners: Set<(p: CardsProgress) => void>
  done: Promise<CardsBack>
}
let current: Run | undefined

function startRun(run: (onProgress: (p: CardsProgress) => void) => Promise<CardsBack>): Run {
  const started = { progress: { found: 0, restored: 0 }, listeners: new Set() } as Run
  started.done = run((p) => {
    started.progress = p
    for (const listen of started.listeners) listen(p)
  }).finally(() => {
    if (current === started) current = undefined
  })
  current = started
  return started
}

export const GetCardsFromAgent: React.FC<{
  agent: Agent
  personas: VtiPersona[]
  /** The linked agent: offered with it even on a phone that holds no identity yet. */
  vtaDid?: string
  deps?: GetCardsDeps
}> = ({ agent, personas, vtaDid, deps }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [progress, setProgress] = useState<CardsProgress | undefined>(current?.progress)
  const [result, setResult] = useState<CardsBack>()
  // Identities taken on by an earlier tap: the screen's list was read before them.
  const [taken, setTaken] = useState<VtiPersona[]>([])
  const [run, setRun] = useState<Run | undefined>(current)

  // Follow the run, this screen's or one started before it was opened again.
  useEffect(() => {
    if (!run) return
    let live = true
    run.listeners.add(setProgress)
    setProgress(run.progress)
    run.done
      .then((got) => {
        if (!live) return
        if (got.taken?.length) setTaken((before) => [...before, ...(got.taken ?? [])])
        setResult(got)
      })
      .catch(() => undefined)
    return () => {
      live = false
      run.listeners.delete(setProgress)
    }
  }, [run])
  const running = progress !== undefined && result === undefined
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  if (personas.length === 0 && !vtaDid) return null

  const start = () => {
    if (current) return
    setResult(undefined)
    setRun(startRun((onProgress) => bringBackFromAgent(agent, vtaDid, [...personas, ...taken], onProgress, deps)))
  }

  const refusedBy = (reason: RecoveredRefusal['reason']) =>
    result?.refused.filter((r) => r.reason === reason).length ?? 0

  return (
    <View style={styles.card} testID={testIdWithKey('AgentGetCards')}>
      <ThemedText variant="labelTitle">{t('VtaLink.GetCardsTitle')}</ThemedText>
      <ThemedText style={styles.muted}>{t('VtaLink.GetCardsBody')}</ThemedText>
      {running ? (
        <View style={styles.row}>
          <ActivityIndicator color={ColorPalette.brand.primary} />
          <ThemedText testID={testIdWithKey('AgentGetCardsProgress')}>
            {progress!.read !== undefined && progress!.read < progress!.found
              ? t('VtaLink.GetCardsReading', { read: progress!.read, found: progress!.found })
              : t('VtaLink.GetCardsProgress', { found: progress!.found, restored: progress!.restored })}
          </ThemedText>
        </View>
      ) : null}
      {result ? (
        <View testID={testIdWithKey('AgentGetCardsResult')}>
          {result.adopted ? (
            <ThemedText testID={testIdWithKey('AgentGetCardsCommunities')}>
              {t('VtaLink.CommunitiesBack', { count: result.adopted })}
            </ThemedText>
          ) : null}
          {/* Why no community came back, in words: what a person whose communities are missing can act on. */}
          {result.noneBecause ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('AgentGetCardsNoCommunities')}>
              {result.noneBecause === 'noCards'
                ? t('VtaLink.CommunitiesNoCards')
                : result.noneBecause === 'agentItself'
                  ? t('VtaLink.CommunitiesAgentItself')
                  : result.visibleContexts
                    ? t('VtaLink.CommunitiesNoneSeenScoped', {
                        contexts: result.visibleContexts.join(', '),
                        interpolation: { escapeValue: false },
                      })
                    : t('VtaLink.CommunitiesNoneSeen')}
            </ThemedText>
          ) : null}
          {result.unreadableIdentities ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('AgentGetCardsUnreadableIdentities')}>
              {t('VtaLink.CommunitiesUnreadable', { count: result.unreadableIdentities })}
            </ThemedText>
          ) : null}
          <ThemedText testID={testIdWithKey('AgentGetCardsSummary')}>
            {result.restored > 0
              ? t('VtaLink.CardsBack', { count: result.restored })
              : result.already
                ? t('VtaLink.CardsBackNothingNew', { count: result.already })
                : result.found > 0
                  ? t('VtaLink.CardsBackNoneKept')
                  : result.unreachable === (result.asked ?? personas.length)
                    ? t('VtaLink.CardsBackUnreachable')
                    : t('VtaLink.CardsBackNone')}
          </ThemedText>
          {(Object.keys(REFUSED_WORDS) as RecoveredRefusal['reason'][])
            .filter((reason) => refusedBy(reason) > 0)
            .map((reason) => (
              <ThemedText key={reason} style={styles.muted} testID={testIdWithKey(`AgentGetCardsRefused_${reason}`)}>
                {t(REFUSED_WORDS[reason], { count: refusedBy(reason) })}
              </ThemedText>
            ))}
          {result.unreachable > 0 && result.unreachable < (result.asked ?? personas.length) ? (
            <ThemedText style={styles.muted}>{t('VtaLink.CardsBackSomeUnreachable')}</ThemedText>
          ) : null}
        </View>
      ) : null}
      <Button
        title={t('VtaLink.GetCardsButton')}
        buttonType={ButtonType.Secondary}
        disabled={running}
        onPress={start}
        testID={testIdWithKey('AgentGetCardsButton')}
      />
      {/* When to use it: it copies the agent's cards back to this phone, and
          nothing else (Alberto, K7, 10-04). */}
      <ThemedText style={styles.muted} testID={testIdWithKey('AgentGetCardsHint')}>
        {t('VtaLink.GetCardsHint')}
      </ThemedText>
    </View>
  )
}
