/**
 * What a request card says about who asks and what for (Alberto's approval
 * loop on al-signer, 10-06: "Someone asks your agent to run
 * vta/contexts/create/1.0", and "Keyring couldn't tell what this would do").
 */
import { fireEvent, render } from '@testing-library/react-native'
import i18n from 'i18next'
import React from 'react'

import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { VtaAgentController } from '../module/vtaAgent'
import { ApprovalDetails } from '../screens/ApprovalDetails'
import { requestLine, requesterName, TASK_WORDS, taskPath, taskWords } from '../screens/requestWords'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const SPEC = 'https://trusttasks.org/spec/'
const PHONE = 'did:peer:2.phone'
const COMPUTER = 'did:key:z6MkComputer'

describe('the words', () => {
  beforeAll(async () => {
    await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
  })
  const t = i18n.t.bind(i18n)

  it('names the common tasks in plain words, and only those', () => {
    expect(taskPath(`${SPEC}vta/contexts/create/1.0`)).toBe('vta/contexts/create')
    expect(taskWords(`${SPEC}vta/contexts/create/1.0`, t)).toBe('create a context (a group of identities)')
    expect(taskWords(`${SPEC}acl/grant/0.2`, t)).toBe('give a device access to your agent')
    expect(taskWords(`${SPEC}vta/something/new/0.1`, t)).toBeUndefined()
  })

  it('names who asked: this phone, a device by its name on My devices, a key by its kind — never the DID', () => {
    const context = {
      managerDid: PHONE,
      knownDevices: {
        [COMPUTER]: { did: COMPUTER, label: 'al-mac', isThisPhone: false },
        'did:key:z6MkPlugin': { did: 'did:key:z6MkPlugin', displayName: 'Work laptop', isThisPhone: false },
      },
    }
    expect(requesterName(PHONE, context, t)).toBe('This phone')
    expect(requesterName(COMPUTER, context, t)).toBe('al-mac')
    expect(requesterName('did:key:z6MkPlugin', context, t)).toBe('Work laptop')
    expect(requesterName('did:key:z6MkUnseen', context, t)).toBe('A computer or other app')
    for (const did of [PHONE, COMPUTER, 'did:key:z6MkUnseen'])
      expect(requesterName(did, context, t)).not.toMatch(/did:/)
  })

  it('says the request in one sentence, falling back to the task name for one without words', () => {
    const context = { knownDevices: { [COMPUTER]: { did: COMPUTER, label: 'al-mac', isThisPhone: false } } }
    expect(requestLine({ requester: COMPUTER, taskType: `${SPEC}vta/contexts/create/1.0` }, context, t)).toBe(
      'al-mac asks your agent to create a context (a group of identities)'
    )
    expect(requestLine({ requester: COMPUTER, taskType: `${SPEC}vta/something/new/0.1` }, context, t)).toMatch(
      /^al-mac asks your agent to run vta\/something\/new\/0\.1/
    )
  })

  it('exist in every language', () => {
    for (const words of [en, fr, ptBr]) {
      const requests = words.Requests as Record<string, unknown>
      for (const key of Object.values(TASK_WORDS)) expect(typeof requests[key.replace('Requests.', '')]).toBe('string')
      for (const key of [
        'ThisPhone',
        'AsksTo',
        'TaskDoes',
        'About',
        'ApproveIfYouStartedIt',
        'ShowFullCode',
        'HideFullCode',
      ])
        expect(typeof requests[key]).toBe('string')
    }
  })
})

describe('what approving would do, when the agent did not say', () => {
  const approval = {
    matchCode: '0af466',
    payloadDigest: 'zQmP5QwFGQirRyDYDwAtFoKdEEhF7zFHVhWbeWhepszs3Qm',
    taskType: `${SPEC}vta/contexts/create/1.0`,
    subject: 'keyring-demo',
  }

  it("a task Keyring knows: says what it is, in words that say they are Keyring's, and the subject", () => {
    const tree = render(
      <BasicAppContext>
        <ApprovalDetails approval={approval} />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey('ApprovalTaskDoes'))).toHaveTextContent(/Requests\.TaskDoes/)
    expect(tree.getByTestId(testIdWithKey('ApprovalSubject'))).toHaveTextContent(/Requests\.About/)
    expect(tree.getByTestId(testIdWithKey('ApprovalOutcomeUnknown'))).toHaveTextContent(
      /Requests\.ApproveIfYouStartedIt/
    )
  })

  it('a task it does not know: as before', () => {
    const tree = render(
      <BasicAppContext>
        <ApprovalDetails approval={{ ...approval, taskType: `${SPEC}vta/something/new/0.1`, subject: undefined }} />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(testIdWithKey('ApprovalTaskDoes'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('ApprovalOutcomeUnknown'))).toHaveTextContent(
      /MyAgent\.ApprovalOutcomeUnknown/
    )
  })

  it('a subject that is a DID is not shown (#12)', () => {
    const tree = render(
      <BasicAppContext>
        <ApprovalDetails approval={{ ...approval, subject: 'did:webvh:QmX:host:p' }} />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(testIdWithKey('ApprovalSubject'))).toBeNull()
  })

  it('the full digest is behind a toggle under the code, for a tool that prints the whole of it', () => {
    const tree = render(
      <BasicAppContext>
        <ApprovalDetails approval={approval} />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey('ApprovalMatchCode'))).toHaveTextContent('0af466')
    expect(tree.queryByTestId(testIdWithKey('ApprovalDigest'))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('ApprovalDigestToggle')))
    expect(tree.getByTestId(testIdWithKey('ApprovalDigest'))).toHaveTextContent(approval.payloadDigest)
  })
})

describe('the devices a request card can name', () => {
  it('are kept from each read of the device list', () => {
    const vta = new VtaAgentController()
    ;(vta as unknown as { rememberDevices(d: object[]): void }).rememberDevices([
      { did: COMPUTER, label: 'al-mac', isThisPhone: false, source: 'aclOnly' },
      { did: PHONE, displayName: 'iPhone', isThisPhone: true, source: 'registered' },
    ])
    expect(vta.getState().knownDevices).toEqual({
      [COMPUTER]: { did: COMPUTER, label: 'al-mac', isThisPhone: false },
      [PHONE]: { did: PHONE, displayName: 'iPhone', isThisPhone: true },
    })
  })
})
