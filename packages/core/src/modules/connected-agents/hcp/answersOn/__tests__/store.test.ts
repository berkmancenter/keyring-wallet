/**
 * The "Answers on" record over memory generic records: one per connection under `keyring/hcp-answers`; no record is
 * `off`; a `deny` for an operator locks every connection of that operator; and the operator lock queues changes.
 */
import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { HcpConnectionStore } from '../../store'
import { CLIENT_VID, OTHER_VID } from '../../__tests__/fixtures/hcpApproval'
import { HcpAnswersStore, type HcpAnswersRecord } from '../store'

const OPERATOR = 'did:web:labs.example'
const OTHER_OPERATOR = 'did:web:other.example'

function fakeAgent() {
  const genericRecords = memoryGenericRecords()
  return { agent: { genericRecords } as unknown as Agent, genericRecords }
}

const record = (change: Partial<HcpAnswersRecord> = {}): HcpAnswersRecord => ({
  id: CLIENT_VID,
  state: 'on',
  directiveId: 'urn:uuid:d5f7b9c1-3e2a-4d6f-8b0e-2c4a6e8f0b19',
  setAt: '2026-11-27T12:00:01.000Z',
  operatorId: OPERATOR,
  ...change,
})

describe('HcpAnswersStore', () => {
  it('keeps one record per connection under its own record type; a second put replaces the first', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new HcpAnswersStore(agent)
    await store.put(record())
    await store.put(record({ state: 'offForGood' }))
    expect(genericRecords.records).toHaveLength(1)
    expect(genericRecords.records[0].tags).toEqual({
      recordType: 'keyring/hcp-answers',
      kind: 'answers',
      key: CLIENT_VID,
    })
    await expect(store.get(CLIENT_VID)).resolves.toEqual(record({ state: 'offForGood' }))
  })

  it('no record reads off; a permit reads on; a deny reads offForGood', async () => {
    const { agent } = fakeAgent()
    const store = new HcpAnswersStore(agent)
    await expect(store.state(CLIENT_VID, OPERATOR)).resolves.toBe('off')
    await store.put(record())
    await expect(store.state(CLIENT_VID, OPERATOR)).resolves.toBe('on')
    await store.put(record({ state: 'offForGood' }))
    await expect(store.state(CLIENT_VID, OPERATOR)).resolves.toBe('offForGood')
  })

  it('a deny set through one connection locks every connection of the same operator, and no other', async () => {
    const { agent } = fakeAgent()
    const store = new HcpAnswersStore(agent)
    await store.put(record({ id: OTHER_VID, state: 'offForGood' }))
    await store.put(record())
    await expect(store.state(CLIENT_VID, OPERATOR)).resolves.toBe('offForGood')
    await expect(store.state(CLIENT_VID, OTHER_OPERATOR)).resolves.toBe('off')
  })

  it('a permit recorded for another operator does not read on for this one', async () => {
    const { agent } = fakeAgent()
    const store = new HcpAnswersStore(agent)
    await store.put(record({ operatorId: OTHER_OPERATOR }))
    await expect(store.state(CLIENT_VID, OPERATOR)).resolves.toBe('off')
  })

  it('neither lists the HCP connection records, nor is listed by them', async () => {
    const { agent } = fakeAgent()
    const store = new HcpAnswersStore(agent)
    await store.put(record())
    await expect(new HcpConnectionStore(agent).list()).resolves.toEqual([])
    await expect(store.list()).resolves.toEqual([record()])
  })

  it('locked runs one operator’s work in order, and another operator’s beside it', async () => {
    const { agent } = fakeAgent()
    const store = new HcpAnswersStore(agent)
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const first = store.locked(OPERATOR, async () => {
      await gate
      order.push('first')
    })
    const second = store.locked(OPERATOR, async () => {
      order.push('second')
    })
    const other = store.locked(OTHER_OPERATOR, async () => {
      order.push('other')
    })
    await other
    expect(order).toEqual(['other'])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['other', 'first', 'second'])
  })

  // control: the operator-wide lock is per operator: another operator's deny does not lock this one.
  it('control: a deny for another operator leaves this one’s permit on', async () => {
    const { agent } = fakeAgent()
    const store = new HcpAnswersStore(agent)
    await store.put(record())
    await store.put(record({ id: OTHER_VID, state: 'offForGood', operatorId: OTHER_OPERATOR }))
    await expect(store.state(CLIENT_VID, OPERATOR)).resolves.toBe('on')
  })
})
