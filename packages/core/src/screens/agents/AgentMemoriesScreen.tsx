/**
 * "Your memories" (agent-connect plan §3.15, step 7.16; backlog 2 R1): `MemoriesListView` over `useMemories()` and
 * the counts, and step 7.16's delete through `DeleteMemorySheet`. A container only: it reads hooks and passes props.
 *
 * "Delete" on a row previews the delete (`useDeleteMemory().preview`) and opens the sheet on that answer; the sheet's
 * own "Delete" is the only caller of `useDeleteMemory().remove(id, true)`. Once a memory is gone the list is read again.
 *
 * Registered by R1 only: it is reached from the details' memories group and, after R2, from "My VTA".
 */
import type { StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useMemo, useState } from 'react'
import { Modal } from 'react-native'

import { useDeleteMemory, useMemories, useMemoryCounts } from '../../modules/connected-agents/ConnectedAgentsProvider'
import DeleteMemorySheet from '../../modules/connected-agents/screens/DeleteMemorySheet'
import MemoriesListView from '../../modules/connected-agents/screens/MemoriesListView'
import { MyAgentStackParams, Screens } from '../../types/navigators'

import { formatAgentDate } from './AgentDetailsScreen'

type AgentMemoriesScreenProps = StackScreenProps<MyAgentStackParams, Screens.AgentMemories>

type Deleting = {
  id: string
  name: string
  preview: Awaited<ReturnType<ReturnType<typeof useDeleteMemory>['preview']>>
}

/**
 * The counts' baseline key. The counts hook stores each count as the rise baseline of one agent; this list is no
 * agent's, so it keeps its own under a key no agent record has (an agent's id is its DID), and never moves an agent's.
 */
const LIST_COUNT_KEY = 'memories-list'

const MemoriesList: React.FC<{ onDelete: (memory: { id: string; name: string }) => void }> = ({ onDelete }) => {
  const { memories, loading } = useMemories()
  const ids = useMemo(() => memories.map((m) => m.id), [memories])
  const counted = useMemoryCounts(LIST_COUNT_KEY, ids)
  const counts = useMemo(() => {
    if (ids.length > 0 && counted.length === 0) return undefined
    return Object.fromEntries(
      counted.map((c) => [
        c.contextId,
        c.failed
          ? ({ ok: false } as const)
          : ({ ok: true, count: c.count, lastChange: c.lastChange, complete: c.complete } as const),
      ])
    )
  }, [counted, ids])
  return (
    <MemoriesListView
      memories={loading && memories.length === 0 ? undefined : memories}
      counts={counts}
      formatDate={formatAgentDate}
      onDelete={(id) => {
        const memory = memories.find((m) => m.id === id)
        if (memory) onDelete(memory)
      }}
    />
  )
}

const AgentMemoriesScreen: React.FC<AgentMemoriesScreenProps> = () => {
  const { preview, remove } = useDeleteMemory()
  const [deleting, setDeleting] = useState<Deleting>()
  // Bumped once a memory is gone, so the list (and its counts) is read again.
  const [generation, setGeneration] = useState(0)

  const onDelete = useCallback(
    (memory: { id: string; name: string }) => {
      void preview(memory.id)
        .then((answer) => setDeleting({ ...memory, preview: answer }))
        .catch(() => setDeleting({ ...memory, preview: { ok: false, code: 'unreachable' } }))
    },
    [preview]
  )
  const close = useCallback(() => setDeleting(undefined), [])
  const done = useCallback(() => {
    setDeleting(undefined)
    setGeneration((g) => g + 1)
  }, [])

  return (
    <>
      <MemoriesList key={generation} onDelete={onDelete} />
      {deleting ? (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
          <DeleteMemorySheet
            memory={{ name: deleting.name }}
            preview={deleting.preview}
            onConfirm={() => remove(deleting.id, true)}
            onKeep={close}
            onDone={done}
          />
        </Modal>
      ) : null}
    </>
  )
}

export default AgentMemoriesScreen
