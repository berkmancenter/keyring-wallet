/**
 * The HCP new memory (backlog Section C, U3), drawn from props for the screen catalogue (screenCatalogue.test.tsx), one
 * per entry of e2e/lib/agent-connect-screens.hcp-memory.json. Test support, not a test.
 */
import React from 'react'

import type { HcpAddMemoryResult } from '../../hcp/newMemory'
import HcpNewMemoryView from '../../hcp/screens/HcpNewMemoryView'

import { HCP_WORD_SOURCE } from './hcpWordSource'
import type { WordSource } from './wordSource'

const none = () => undefined

/** Frame 51's sample: the agent's name, and the demo script's memory. Made up, not words. */
export const HCP_MEMORY_NAME = 'Notes helper'
export const HCP_MEMORY_SAMPLE = "I'm vegetarian"

// Both states start from frame 51's sample text, as the frame draws it.
const view = (result: HcpAddMemoryResult) => (
  <HcpNewMemoryView name={HCP_MEMORY_NAME} onSave={async () => result} onDone={none} initialText={HCP_MEMORY_SAMPLE} />
)

export const SCREEN_STATES: Record<string, () => React.ReactElement> = {
  'hcp-new-memory': () => view({ ok: true, entry: {} }),
  'hcp-new-memory-not-saved': () => view({ ok: false, unreachable: true, message: { key: 'MemoryNotSaved' } }),
}

export const WORD_SOURCES: WordSource[] = [HCP_WORD_SOURCE]
