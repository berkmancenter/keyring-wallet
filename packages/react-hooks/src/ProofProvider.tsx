import type { RecordsState } from './recordUtils'
import type { PropsWithChildren } from 'react'
import { DidCommProofState, DidCommProofExchangeRecord } from '@credo-ts/didcomm'
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
import { BifoldAgent } from './agent'

const ProofContext = createContext<RecordsState<DidCommProofExchangeRecord> | undefined>(undefined)

export const useProofs = () => {
  const proofContext = useContext(ProofContext)
  if (!proofContext) {
    throw new Error('useProofs must be used within a ProofContextProvider')
  }
  return proofContext
}

export const useProofsByConnectionId = (connectionId: string): DidCommProofExchangeRecord[] => {
  const { records: proofs } = useProofs()
  return useMemo(
    () => proofs.filter((proof: DidCommProofExchangeRecord) => proof.connectionId === connectionId),
    [proofs, connectionId]
  )
}

export const useProofById = (id: string): DidCommProofExchangeRecord | undefined => {
  const { records: proofs } = useProofs()
  return proofs.find((p: DidCommProofExchangeRecord) => p.id === id)
}

export const useProofByState = (state: DidCommProofState | DidCommProofState[]): DidCommProofExchangeRecord[] => {
  // key on contents, not array identity — callers often pass fresh array literals
  const stateKey = typeof state === 'string' ? state : state.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const states = useMemo(() => (typeof state === 'string' ? [state] : state), [stateKey])

  const { records: proofs } = useProofs()

  const filteredProofs = useMemo(
    () =>
      proofs.filter((r: DidCommProofExchangeRecord) => {
        if (states.includes(r.state)) return r
      }),
    [proofs, states]
  )

  return filteredProofs
}

export const useProofNotInState = (state: DidCommProofState | DidCommProofState[]): DidCommProofExchangeRecord[] => {
  // key on contents, not array identity — callers often pass fresh array literals
  const stateKey = typeof state === 'string' ? state : state.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const states = useMemo(() => (typeof state === 'string' ? [state] : state), [stateKey])

  const { records: proofs } = useProofs()

  const filteredProofs = useMemo(
    () =>
      proofs.filter((r: DidCommProofExchangeRecord) => {
        if (!states.includes(r.state)) return r
      }),
    [proofs, states]
  )

  return filteredProofs
}

interface Props {
  agent: BifoldAgent | undefined
}

const ProofProvider: React.FC<PropsWithChildren<Props>> = ({ agent, children }) => {
  const [state, setState] = useState<RecordsState<DidCommProofExchangeRecord>>({
    records: [],
    loading: true,
  })

  const setInitialState = useCallback(async () => {
    if (!agent) {
      setState({ records: [], loading: true })
      return
    }
    const records = await agent.modules.didcomm.proofs.getAll()
    setState({ records, loading: false })
  }, [agent])

  useEffect(() => {
    setInitialState()
  }, [setInitialState])

  useEffect(() => {
    if (!agent || state.loading) return

    // Functional setState updaters only — see recordUtils.ts. Plain `state` here would
    // drop one of two proof records saved in the same tick.
    const proofAdded$ = recordsAddedByType(agent, DidCommProofExchangeRecord).subscribe((record) =>
      setState((prevState) => addRecord(record, prevState))
    )

    const proofUpdated$ = recordsUpdatedByType(agent, DidCommProofExchangeRecord).subscribe((record) =>
      setState((prevState) => updateRecord(record, prevState))
    )

    const proofRemoved$ = recordsRemovedByType(agent, DidCommProofExchangeRecord).subscribe((record) =>
      setState((prevState) => removeRecord(record, prevState))
    )

    return () => {
      proofAdded$?.unsubscribe()
      proofUpdated$?.unsubscribe()
      proofRemoved$?.unsubscribe()
    }
  }, [agent, state.loading])

  return <ProofContext.Provider value={state}>{children}</ProofContext.Provider>
}

export default ProofProvider
