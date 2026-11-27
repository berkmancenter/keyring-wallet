/**
 * The "Acting as" states of the connect form (finding 18, §7.7; canvas frame 58), drawn from props for the screen
 * catalogue: e2e/lib/agent-connect-screens.u5-acting-as.json lists them. Made-up names only, as the canvas draws them.
 */
import React from 'react'

import { ActingAsPersona } from '../../components/ActingAsRow'
import ConnectAgentForm from '../../screens/ConnectAgentForm'

import { MEMORIES } from './screenStates'

const none = () => undefined
const never = () => new Promise<never>(() => undefined)

export const PERSONAS: ActingAsPersona[] = [
  { did: 'did:example:persona-ada', name: 'Ada' },
  { did: 'did:example:persona-ada-college', name: 'Ada at Example College' },
]

const form = () => (
  <ConnectAgentForm
    guard="ok"
    memories={MEMORIES}
    personas={PERSONAS}
    onCreateMemory={never}
    onContinue={none}
    onClose={none}
  />
)

// Both states draw the same form; the manifest's steps open the list and, for the second, choose "Ada".
export const SCREEN_STATES: Record<string, () => React.ReactElement> = {
  'connect-acting-as': form,
  'connect-acting-as-chosen': form,
}
