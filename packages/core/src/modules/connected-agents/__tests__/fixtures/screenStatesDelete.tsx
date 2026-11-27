/**
 * Agent connect, step 7.16: how each state of deleting a memory in e2e/lib/agent-connect-screens.delete.json is drawn
 * from props, for the catalogue test (screenCatalogue.test.tsx). Test support, not a test: the manifest names each
 * state, its canvas frame and the words it shows; this file says which view and props draw it.
 */
import React from 'react'

import type { DeleteMemoryResult, DeletePreview } from '../../deleteMemory'
import type { MemoryCount } from '../../memories'
import DeleteMemorySheet from '../../screens/DeleteMemorySheet'
import MemoriesListView, { ListedMemory } from '../../screens/MemoriesListView'

const none = () => undefined
const formatDate = (iso: string) => iso.slice(11, 16)

// Sample data, as the canvas draws it: made-up names only.
export const DELETE_MEMORIES: ListedMemory[] = [
  { id: 'keyring-memory-aaaa', name: 'Education' },
  { id: 'keyring-memory-bbbb', name: 'Healthcare' },
  { id: 'keyring-memory-cccc', name: 'Housing' },
]
const counted = (count: number, lastChange?: string): MemoryCount => ({
  ok: true,
  count,
  complete: true,
  ...(lastChange ? { lastChange } : {}),
})
// Frame 57: a count with its last change, one over the limit, and one that failed.
const COUNTS: Record<string, MemoryCount> = {
  'keyring-memory-aaaa': counted(214, '2026-11-24T09:12:00.000Z'),
  'keyring-memory-bbbb': counted(1240, '2026-11-26T16:40:00.000Z'),
  'keyring-memory-cccc': { ok: false },
}
// memories-list-count-failed: no count at all came back, so every row says so.
const NO_COUNTS: Record<string, MemoryCount> = {}

const NOTES = { subject: 'did:key:z6MkNotes', name: 'Notes helper' }
const preview = (over: Partial<Extract<DeletePreview, { ok: true }>> = {}): DeletePreview => ({
  ok: true,
  count: counted(12, '2026-11-26T16:40:00.000Z'),
  overWarning: false,
  agents: [NOTES],
  ...over,
})
const answers = (result: DeleteMemoryResult) => () => Promise.resolve(result)
const sheet = (p: DeletePreview, result: DeleteMemoryResult = { ok: true, recordsNotUpdated: 0 }) => (
  <DeleteMemorySheet
    memory={{ name: 'Healthcare' }}
    preview={p}
    onConfirm={answers(result)}
    onKeep={none}
    onDone={none}
  />
)

export const SCREEN_STATES: Record<string, () => React.ReactElement> = {
  'memories-list': () => (
    <MemoriesListView memories={DELETE_MEMORIES} counts={COUNTS} formatDate={formatDate} onDelete={none} />
  ),
  'memories-list-count-failed': () => (
    <MemoriesListView memories={DELETE_MEMORIES} counts={NO_COUNTS} formatDate={formatDate} onDelete={none} />
  ),
  'memories-list-no-date': () => (
    <MemoriesListView
      memories={[DELETE_MEMORIES[0]]}
      counts={{ 'keyring-memory-aaaa': counted(0) }}
      formatDate={formatDate}
      onDelete={none}
    />
  ),
  'memories-list-counting': () => <MemoriesListView memories={DELETE_MEMORIES} formatDate={formatDate} onDelete={none} />,
  'delete-memory': () => sheet(preview()),
  'delete-memory-no-agents': () => sheet(preview({ agents: [] })),
  'delete-memory-unnamed-agent': () => sheet(preview({ agents: [NOTES, { subject: 'did:key:z6MkOther', name: '' }] })),
  'delete-memory-over-limit': () => sheet(preview({ count: counted(1240), overWarning: true })),
  'delete-memory-preview-unreachable': () => sheet({ ok: false, code: 'unreachable' }),
  'delete-memory-held': () => sheet(preview(), { ok: false, code: 'heldForApproval' }),
  'delete-memory-records-left': () => sheet(preview(), { ok: true, recordsNotUpdated: 2 }),
  'delete-memory-unreachable': () => sheet(preview(), { ok: false, code: 'unreachable' }),
}
