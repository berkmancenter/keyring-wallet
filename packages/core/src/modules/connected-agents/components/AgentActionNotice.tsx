import React from 'react'
import { useTranslation } from 'react-i18next'

import { testIdWithKey } from '../../../utils/testable'

import ConnectNotice from './ConnectNotice'

/**
 * The agent actions whose failure the screens word (ac's #1122 obligation 1; backlog 3). `retryPending` keeps §6's
 * pending line and its "Try again" when unreachable; only its `noRecord` and `notOffered` get a line here.
 */
export type AgentActionName =
  | 'extend'
  | 'restore'
  | 'retryPending'
  | 'remove'
  | 'keepConnected'
  | 'addMemory'
  | 'removeMemory'

/**
 * The words for one failed (or partly done) action. Each key is its own fact: there is no generic line, so a case a
 * line would contradict gets a line of its own. The map from an action's code to its key is the logic's
 * (`agentActionLine`, fb); the words are these, all PROPOSED until §6 quotes them.
 */
export type AgentActionLineKey =
  | 'ActionGone'
  | 'ActionNotOffered'
  | 'ActionNotListed'
  | 'ActionNotConfirmed'
  | 'ActionNotApplied'
  | 'RestoreLastMemory'
  | 'ExtendNoCredential'
  | 'RemoveNotAvailable'
  | 'RemoveNotConfirmed'
  | 'RemoveGoneUnproven'
  | 'KeepNotSaved'
  | 'KeepNotRecorded'
  | 'KeepNoCredential'

export interface AgentActionLine {
  key: AgentActionLineKey
  /** The agent's name, for the lines that name it. */
  name?: string
}

/**
 * The action went through, and something after it did not: told as a warning, not as a refusal. Every other key is a
 * refusal, or an outcome nobody can confirm, and is told as an error.
 */
const PARTLY_DONE: ReadonlySet<AgentActionLineKey> = new Set([
  'ExtendNoCredential',
  'KeepNotRecorded',
  'KeepNoCredential',
])

export const agentActionLineTone = (key: AgentActionLineKey): 'warn' | 'error' =>
  PARTLY_DONE.has(key) ? 'warn' : 'error'

export interface AgentActionNoticeProps {
  line: AgentActionLine
  testID?: string
}

/**
 * The line an action's outcome left, drawn where the action's control was: the line spends the action, so the
 * control is not drawn beside it (a refusal spends the words and the control). Announced as an alert.
 */
const AgentActionNotice: React.FC<AgentActionNoticeProps> = ({ line, testID = testIdWithKey('AgentActionLine') }) => {
  const { t } = useTranslation()
  return (
    <ConnectNotice
      text={t(`ConnectedAgents.${line.key}`, { name: line.name ?? '' })}
      tone={agentActionLineTone(line.key)}
      testID={testID}
    />
  )
}

export default AgentActionNotice
