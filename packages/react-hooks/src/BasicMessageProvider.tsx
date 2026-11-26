import type { RecordsState } from './recordUtils'
import type { PropsWithChildren } from 'react'
import { DidCommBasicMessageRecord } from '@credo-ts/didcomm'
import { useState, createContext, useContext, useEffect, useMemo, useCallback } from 'react'
import * as React from 'react'
import {
  recordsAddedByType,
  recordsRemovedByType,
  recordsUpdatedByType,
  removeRecord,
  updateRecord,
  addRecord,
} from './recordUtils'
import { BifoldAgent } from './agent'

const BasicMessageContext = createContext<RecordsState<DidCommBasicMessageRecord> | undefined>(undefined)

export const useBasicMessages = () => {
  const basicMessageContext = useContext(BasicMessageContext)
  if (!basicMessageContext) {
    throw new Error('useBasicMessages must be used within a BasicMessageContextProvider')
  }
  return basicMessageContext
}

export const useBasicMessagesByConnectionId = (connectionId: string): DidCommBasicMessageRecord[] => {
  const { records: basicMessages } = useBasicMessages()

  const messages = useMemo(
    () => basicMessages.filter((m) => m.connectionId === connectionId),
    [basicMessages, connectionId],
  )

  return messages
}

interface Props {
  agent: BifoldAgent | undefined
}

const BasicMessageProvider: React.FC<PropsWithChildren<Props>> = ({ agent, children }) => {
  const [state, setState] = useState<RecordsState<DidCommBasicMessageRecord>>({
    records: [],
    loading: true,
  })

  const setInitialState = useCallback(async () => {
    if (!agent) {
      setState({ records: [], loading: true })
      return
    }
    const records = await agent.modules.didcomm.basicMessages.findAllByQuery({})
    setState({ records, loading: false })
  }, [agent])

  useEffect(() => {
    setInitialState()
  }, [setInitialState])

  useEffect(() => {
    if (!agent || state.loading) return

    // Functional setState updaters only — see recordUtils.ts. Plain `state` here would
    // drop one of two messages saved in the same tick.
    const basicMessageAdded$ = recordsAddedByType(agent, DidCommBasicMessageRecord).subscribe((record) =>
      setState((prevState) => addRecord(record, prevState)),
    )

    const basicMessageUpdated$ = recordsUpdatedByType(agent, DidCommBasicMessageRecord).subscribe((record) =>
      setState((prevState) => updateRecord(record, prevState)),
    )

    const basicMessageRemoved$ = recordsRemovedByType(agent, DidCommBasicMessageRecord).subscribe((record) =>
      setState((prevState) => removeRecord(record, prevState)),
    )

    return () => {
      basicMessageAdded$?.unsubscribe()
      basicMessageUpdated$?.unsubscribe()
      basicMessageRemoved$?.unsubscribe()
    }
  }, [agent, state.loading])

  return <BasicMessageContext.Provider value={state}>{children}</BasicMessageContext.Provider>
}

export default BasicMessageProvider
