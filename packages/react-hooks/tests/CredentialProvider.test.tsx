import type { Agent } from '@credo-ts/core'
import * as React from 'react'
import { act, create } from 'react-test-renderer'
import { Subject, filter } from 'rxjs'

// testEnvironment: 'node' doesn't set this, so react-test-renderer warns that
// act() isn't "supported" even though it works fine here.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Regression test for a stale-closure race: two credential-exchange records
 * saved back-to-back (e.g. a VRC offer + an RCard offer arriving within the
 * same tick) must both survive in state. Previously the subscribe callbacks
 * called `setState(addRecord(record, state))`, closing over `state` from the
 * last render instead of the latest pending state, so the second update
 * silently overwrote the first.
 *
 * @credo-ts/* ship ESM-only builds that this package's plain ts-jest config
 * isn't set up to transform, so the real packages are mocked with just the
 * shapes CredentialProvider/recordUtils actually touch at runtime.
 */
jest.mock('@credo-ts/core', () => ({
  RepositoryEventTypes: {
    RecordSaved: 'RecordSaved',
    RecordUpdated: 'RecordUpdated',
    RecordDeleted: 'RecordDeleted',
  },
}))

class FakeCredentialExchangeRecord {
  static type = 'CredentialRecord'
  type = FakeCredentialExchangeRecord.type
  id: string
  state: string
  role: string
  connectionId: string
  credentials: unknown[] = []

  constructor(props: { id: string; state: string; role: string; connectionId: string }) {
    this.id = props.id
    this.state = props.state
    this.role = props.role
    this.connectionId = props.connectionId
  }
}

jest.mock('@credo-ts/didcomm', () => ({
  DidCommCredentialExchangeRecord: FakeCredentialExchangeRecord,
  DidCommCredentialState: { OfferReceived: 'offer-received', Done: 'done' },
  DidCommCredentialRole: { Holder: 'holder', Issuer: 'issuer' },
}))

import CredentialProvider, { useCredentials } from '../src/CredentialProvider'
import type { RecordsState } from '../src/recordUtils'

function makeFakeAgent() {
  const events$ = new Subject<{ type: string; payload: { record: FakeCredentialExchangeRecord } }>()

  const agent = {
    modules: {
      didcomm: {
        credentials: {
          getAll: jest.fn().mockResolvedValue([]),
        },
      },
    },
    events: {
      observable: (eventType: string) => events$.asObservable().pipe(filter((event) => event.type === eventType)),
    },
  } as unknown as Agent

  const emitRecordSaved = (record: FakeCredentialExchangeRecord) => {
    events$.next({ type: 'RecordSaved', payload: { record } })
  }

  return { agent, emitRecordSaved }
}

const makeOfferReceived = (id: string, connectionId: string) =>
  new FakeCredentialExchangeRecord({ id, state: 'offer-received', role: 'holder', connectionId })

describe('CredentialProvider', () => {
  it('does not drop a record when two are saved in rapid succession', async () => {
    let latest: RecordsState<FakeCredentialExchangeRecord> | undefined
    const Capture: React.FC = () => {
      latest = useCredentials() as unknown as RecordsState<FakeCredentialExchangeRecord>
      return null
    }

    const { agent, emitRecordSaved } = makeFakeAgent()

    await act(async () => {
      create(
        <CredentialProvider agent={agent}>
          <Capture />
        </CredentialProvider>
      )
      // let setInitialState()'s getAll() promise resolve
      await Promise.resolve()
      await Promise.resolve()
    })

    const recordA = makeOfferReceived('record-a', 'connection-1')
    const recordB = makeOfferReceived('record-b', 'connection-1')

    act(() => {
      // Synchronous, back-to-back — both subscribe callbacks fire before
      // React commits and the effect resubscribes, reproducing the race.
      emitRecordSaved(recordA)
      emitRecordSaved(recordB)
    })

    expect(latest?.records.map((r) => r.id).sort()).toEqual(['record-a', 'record-b'])
  })
})
