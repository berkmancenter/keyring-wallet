import type { RecordsState } from './recordUtils'
import type { Agent } from '@credo-ts/core'
import type { PropsWithChildren } from 'react'
import { DidCommCredentialExchangeRecord, DidCommCredentialState } from '@credo-ts/didcomm'
import { useState, createContext, useContext, useEffect, useMemo, useCallback } from 'react'
import * as React from 'react'

import {
  recordsRemovedByType,
  recordsUpdatedByType,
  recordsAddedByType,
  removeRecord,
  updateRecord,
  addRecord,
} from './recordUtils'

const CredentialContext = createContext<RecordsState<DidCommCredentialExchangeRecord> | undefined>(undefined)

export const useCredentials = () => {
  const credentialContext = useContext(CredentialContext)
  if (!credentialContext) {
    throw new Error('useCredentials must be used within a CredentialContextProvider')
  }
  return credentialContext
}

export const useCredentialsByConnectionId = (connectionId: string): DidCommCredentialExchangeRecord[] => {
  const { records: credentials } = useCredentials()
  return useMemo(
    () => credentials.filter((credential: DidCommCredentialExchangeRecord) => credential.connectionId === connectionId),
    [credentials, connectionId],
  )
}

export const useCredentialById = (id: string): DidCommCredentialExchangeRecord | undefined => {
  const { records: credentials } = useCredentials()
  return credentials.find((c: DidCommCredentialExchangeRecord) => c.id === id)
}

export const useCredentialByState = (state: DidCommCredentialState | DidCommCredentialState[]): DidCommCredentialExchangeRecord[] => {
  // key on contents, not array identity — callers often pass fresh array literals
  const stateKey = typeof state === 'string' ? state : state.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const states = useMemo(() => (typeof state === 'string' ? [state] : state), [stateKey])

  const { records: credentials } = useCredentials()

  const filteredCredentials = useMemo(
    () => credentials.filter((r: DidCommCredentialExchangeRecord) => states.includes(r.state)),
    [credentials, states],
  )
  return filteredCredentials
}

export const useCredentialNotInState = (state: DidCommCredentialState | DidCommCredentialState[]) => {
  // key on contents, not array identity — callers often pass fresh array literals
  const stateKey = typeof state === 'string' ? state : state.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const states = useMemo(() => (typeof state === 'string' ? [state] : state), [stateKey])

  const { records: credentials } = useCredentials()

  const filteredCredentials = useMemo(
    () => credentials.filter((r: DidCommCredentialExchangeRecord) => !states.includes(r.state)),
    [credentials, states],
  )

  return filteredCredentials
}

interface Props {
  agent: Agent | undefined
}

const CredentialProvider: React.FC<PropsWithChildren<Props>> = ({ agent, children }) => {
  const [state, setState] = useState<RecordsState<DidCommCredentialExchangeRecord>>({
    records: [],
    loading: true,
  })

  const setInitialState = useCallback(async () => {
    if (!agent) {
      setState({ records: [], loading: true })
      return
    }
    const records = await agent.modules.didcomm.credentials.getAll()
    setState({ records, loading: false })
  }, [agent])

  useEffect(() => {
    setInitialState()
  }, [setInitialState])

  useEffect(() => {
    if (!agent || state.loading) return

    // Functional setState updaters only — see recordUtils.ts. Plain `state` here would
    // drop one of two credential records saved in the same tick (e.g. RCard + VRC).
    const credentialAdded$ = recordsAddedByType(agent, DidCommCredentialExchangeRecord).subscribe((record) =>
      setState((prevState) => addRecord(record, prevState)),
    )

    const credentialUpdated$ = recordsUpdatedByType(agent, DidCommCredentialExchangeRecord).subscribe((record) =>
      setState((prevState) => updateRecord(record, prevState)),
    )

    const credentialRemoved$ = recordsRemovedByType(agent, DidCommCredentialExchangeRecord).subscribe((record) =>
      setState((prevState) => removeRecord(record, prevState)),
    )

    return () => {
      credentialAdded$?.unsubscribe()
      credentialUpdated$?.unsubscribe()
      credentialRemoved$?.unsubscribe()
    }
  }, [agent, state.loading])

  return <CredentialContext.Provider value={state}>{children}</CredentialContext.Provider>
}

export default CredentialProvider
