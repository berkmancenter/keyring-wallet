/**
 * One AI agent (agent-connect plan §3.15, §7.7, §7.10; backlog 2 R1): `AgentDetailsView` over the agent-connect hooks,
 * with "Change memories" as an inline sheet, Extend as Approve again, and Revoke through `RevokeAgentSheet`.
 *
 * A container only: it reads hooks and passes props. Its pieces that the agent list shares (the row data, the
 * biometric ask, the Revoke and Extend sheets) are exported for `AiAgentsScreen`, so one call path serves both.
 *
 * **The revoke** is this file's own `revokeAgentConnection(deps, agentId)`, with `deps` from `useRevokeDeps()`, imported
 * by a relative path: the release gate (`connected-agents/__tests__/releaseGate.test.ts`) counts Revoke as wired only
 * for a call in a routed file outside the module, and a wrapper hook inside the module would not count.
 */
import type { StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from 'react-native'

import { requestBiometricConfirmationUI, type BiometricConfirmationCopy } from '../../contexts/biometric-confirmation'
import {
  useAgentActions,
  useAgentConnection,
  useAgentConnections,
  useKeepConnectedOffered,
  useMemories,
  useMemoryCounts,
  useRevokeDeps,
} from '../../modules/connected-agents/ConnectedAgentsProvider'
import { MEMORY_COUNT_WARNING } from '../../modules/connected-agents/memories'
import { TEMPORARY_GRANT_MS } from '../../modules/connected-agents/pairing'
import { revokeAgentConnection } from '../../modules/connected-agents/revoke'
import AgentDetailsView, {
  type AgentDetailsData,
  type MemoryCountData,
} from '../../modules/connected-agents/screens/AgentDetailsView'
import ApproveView from '../../modules/connected-agents/screens/ApproveView'
import ChangeMemoriesView from '../../modules/connected-agents/screens/ChangeMemoriesView'
import RevokeAgentSheet from '../../modules/connected-agents/screens/RevokeAgentSheet'
import { MyAgentStackParams, Screens } from '../../types/navigators'
import { formatTime } from '../../utils/helpers'

/** An agent as the hooks give it (`AgentView`). */
export type ListedAgent = ReturnType<typeof useAgentConnections>['agents'][number]

type PickerMemory = ReturnType<typeof useMemories>['memories'][number]
type CreateMemoryResult = Awaited<ReturnType<ReturnType<typeof useMemories>['create']>>

/** A time the views show ("until 2:30 pm"), in the app's own time format. */
export const formatAgentTime = (ms: number): string => formatTime(new Date(ms), { includeHour: true, trim: true })

/** A date the views show (a memory's last change), in the app's own format. */
export const formatAgentDate = (iso: string): string => formatTime(new Date(iso), { shortMonth: true, trim: true })

/** The list row's and the details' data for an agent: its end formatted for this phone, nothing else changed. */
export function agentRow(agent: ListedAgent): AgentDetailsData {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    until: agent.expiresAt === undefined ? undefined : formatAgentTime(agent.expiresAt),
    temporary: agent.grantType === 'temporary',
    keyChanged: agent.keyChanged,
    drift: agent.drift,
    ownerName: agent.ownerName ?? '',
    memories: agent.memories,
    pending: agent.pending,
  }
}

/**
 * `useMemories().create` as the picker's `onCreateMemory` takes it. The hook answers the new memory as a `MemoryRef`
 * and the picker wants a `PickerMemory`; a memory just made contains no other, so `containsOthers` is false.
 */
export function pickerCreate(
  create: ReturnType<typeof useMemories>['create']
): (name: string) => Promise<{ ok: true; memory: PickerMemory } | Exclude<CreateMemoryResult, { ok: true }>> {
  return async (name) => {
    const result = await create(name)
    return result.ok ? { ok: true, memory: { ...result.memory, containsOthers: false } } : result
  }
}

/**
 * The phone's face or fingerprint check, as the views' `confirm` takes it: true only when it was confirmed. Anything
 * else (cancelled, failed, nothing able to ask) is false, so a view never acts unasked.
 */
export function askBiometric(name: string, id: string, copy: BiometricConfirmationCopy): () => Promise<boolean> {
  return async () => {
    try {
      return (await requestBiometricConfirmationUI(name, id, false, 'biometric', copy)).status === 'confirmed'
    } catch {
      return false
    }
  }
}

/**
 * Step 7.10's Revoke on one agent, as a sheet. "Revoke" runs `revokeAgentConnection(deps, agentId)` and its outcome
 * passes to the sheet as it is; on `revoked` the sheet closes, otherwise it stays and says why, with "Try again".
 */
export const AgentRevokeSheet: React.FC<{
  agentId: string
  name: string
  /** Called once the sheet is closed, revoked or kept, so the caller re-reads its listing. */
  onClose: () => void
}> = ({ agentId, name, onClose }) => {
  const deps = useRevokeDeps()
  const onRevoke = useCallback(async () => {
    const outcome = await revokeAgentConnection(deps, agentId)
    if (outcome.kind === 'revoked') onClose()
    return outcome
  }, [deps, agentId, onClose])
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* P0 has no rooms, so the body is §6's no-room form. */}
      <RevokeAgentSheet name={name} hasRooms={false} onRevoke={onRevoke} onKeep={onClose} />
    </Modal>
  )
}

/**
 * Extend (§7.7): the owner re-asks through Approve and the biometric, and only then `actions.extend` runs. The grant
 * runs 4 hours from now, as Extend sets it.
 */
export const AgentExtendSheet: React.FC<{ agent: ListedAgent; onClose: () => void }> = ({ agent, onClose }) => {
  const { t } = useTranslation()
  const actions = useAgentActions()
  const until = formatAgentTime(Date.now() + TEMPORARY_GRANT_MS)
  const confirm = useMemo(
    () =>
      askBiometric(agent.name, agent.id, {
        title: t('ConnectedAgents.ApproveTitle', { name: agent.name }),
        description: t('ConnectedAgents.ApproveUntil', { time: until }),
      }),
    [agent.name, agent.id, t, until]
  )
  const onApproved = useCallback(() => {
    void actions
      .extend(agent.id)
      .catch(() => undefined)
      .finally(onClose)
  }, [actions, agent.id, onClose])
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ApproveView
        name={agent.name}
        memoryNames={agent.memories.map((m) => m.name)}
        purposes={agent.purposes}
        until={until}
        confirm={confirm}
        onApproved={onApproved}
      />
    </Modal>
  )
}

/** "Change memories" (§3.15 item 5), inline: widening asks the biometric first (D34), and each change re-reads. */
const ChangeMemoriesSheet: React.FC<{ agent: ListedAgent; onChanged: () => void; onClose: () => void }> = ({
  agent,
  onChanged,
  onClose,
}) => {
  const { t } = useTranslation()
  const actions = useAgentActions()
  const { memories, create } = useMemories()
  const confirm = useMemo(
    () =>
      askBiometric(agent.name, agent.id, {
        title: t('ConnectedAgents.ChangeMemories'),
        description: t('ConnectedAgents.WidenBody'),
      }),
    [agent.name, agent.id, t]
  )
  const changed = useCallback(
    async (change: Promise<{ ok: true } | { ok: false; code: string }>) => {
      const result = await change
      onChanged()
      return result
    },
    [onChanged]
  )
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ChangeMemoriesView
        agentName={agent.name}
        memories={memories}
        current={agent.memories.map((m) => m.id)}
        onCreateMemory={pickerCreate(create)}
        confirm={confirm}
        onWiden={(memoryId) => changed(actions.widen(agent.id, memoryId))}
        onNarrow={(memoryId) => changed(actions.narrow(agent.id, memoryId))}
      />
    </Modal>
  )
}

type Sheet = 'memories' | 'extend' | 'revoke' | undefined

type AgentDetailsScreenProps = StackScreenProps<MyAgentStackParams, Screens.AgentDetails>

const AgentDetailsScreen: React.FC<AgentDetailsScreenProps> = ({ navigation, route }) => {
  const { agentId } = route.params
  const { agent, refresh } = useAgentConnection(agentId)
  const actions = useAgentActions()
  const keepConnectedOffered = useKeepConnectedOffered(agentId)
  const contextIds = useMemo(() => agent?.memories.map((m) => m.id) ?? [], [agent])
  const counted = useMemoryCounts(agentId, contextIds)
  const [sheet, setSheet] = useState<Sheet>()

  const counts = useMemo(() => {
    // Undefined while they are counted: the hook answers nothing until it has counted every memory.
    if (contextIds.length > 0 && counted.length === 0) return undefined
    const out: Record<string, MemoryCountData> = {}
    for (const c of counted)
      out[c.contextId] = c.failed
        ? { failed: true }
        : {
            failed: false,
            count: c.count,
            lastChange: c.lastChange ? formatAgentDate(c.lastChange) : undefined,
            rose: c.rose,
          }
    return out
  }, [counted, contextIds])

  const close = useCallback(() => {
    setSheet(undefined)
    void refresh()
  }, [refresh])
  const act = useCallback(
    (run: Promise<unknown>) => {
      void run.catch(() => undefined).finally(() => void refresh())
    },
    [refresh]
  )

  // Not found, or still pairing: nothing to draw (the list does not offer it either).
  if (!agent) return null
  return (
    <>
      <AgentDetailsView
        agent={agentRow(agent)}
        counts={counts}
        warnAbove={MEMORY_COUNT_WARNING}
        onChangeMemories={() => setSheet('memories')}
        onRestore={() => act(actions.restore(agentId))}
        onRetryPending={() => act(actions.retryPending(agentId))}
        onExtend={() => setSheet('extend')}
        onRemove={() =>
          act(
            actions.remove(agentId).then((result) => {
              // Removed: the record is gone, and with it what this screen drew.
              if (result.ok) navigation.goBack()
            })
          )
        }
        onConnectAgain={() => navigation.navigate(Screens.ConnectAgent, { againFrom: agentId })}
        onKeepConnected={keepConnectedOffered ? () => act(actions.keepConnected(agentId)) : undefined}
        onRevoke={() => setSheet('revoke')}
      />
      {sheet === 'memories' ? <ChangeMemoriesSheet agent={agent} onChanged={refresh} onClose={close} /> : null}
      {sheet === 'extend' ? <AgentExtendSheet agent={agent} onClose={close} /> : null}
      {sheet === 'revoke' ? <AgentRevokeSheet agentId={agentId} name={agent.name} onClose={close} /> : null}
    </>
  )
}

export default AgentDetailsScreen
