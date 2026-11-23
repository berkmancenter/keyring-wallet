import fs from 'fs'
import path from 'path'

import { getContactCredentialDetailsForConnection } from '../../modules/vrc/utils/vrcNameHelper'
import { Screens, Stacks } from '../../types/navigators'
import { findUsedInvitation, openUsedInvitation, usedInvitationId, usedInvitationToast } from '../usedInvitation'

jest.mock('../../modules/vrc/utils/vrcNameHelper', () => ({
  getContactCredentialDetailsForConnection: jest.fn(),
}))
const contactFor = getContactCredentialDetailsForConnection as jest.Mock

const refusal = (id: string) =>
  new Error(
    `An out of band record with invitation ${id} has already been received. Invitations should have a unique id.`
  )

const agentWith = ({
  oob = null as { id: string; reuseConnectionId?: string } | null,
  connections = [] as { id: string; alias?: string; theirLabel?: string }[],
} = {}) => ({
  modules: {
    didcomm: {
      oob: { findByReceivedInvitationId: jest.fn(async () => oob) },
      connections: {
        findAllByOutOfBandId: jest.fn(async () => connections),
        findById: jest.fn(async (id: string) => connections.find((c) => c.id === id) ?? null),
      },
    },
  },
  w3cCredentials: { getAll: jest.fn(async () => []) },
})

describe('usedInvitationId', () => {
  it("reads the invitation's id from Credo's refusal", () => {
    expect(usedInvitationId(refusal('inv-1'))).toBe('inv-1')
  })

  it('is undefined for any other error', () => {
    expect(usedInvitationId(new Error('Invitation could not be parsed'))).toBeUndefined()
    expect(usedInvitationId(undefined)).toBeUndefined()
  })

  it("matches the refusal the installed Credo throws, so a reworded one fails here, not on a person's phone", () => {
    const oobApi = path.join(
      path.dirname(require.resolve('@credo-ts/didcomm/package.json')),
      'build/modules/oob/DidCommOutOfBandApi.mjs'
    )
    const template =
      /`(An out of band record with invitation \$\{outOfBandInvitation\.id\} has already been received[^`]*)`/.exec(
        fs.readFileSync(oobApi, 'utf8')
      )?.[1]
    expect(template).toBeDefined()
    expect(usedInvitationId(new Error(template!.replace('${outOfBandInvitation.id}', 'inv-2')))).toBe('inv-2')
  })
})

describe('findUsedInvitation', () => {
  beforeEach(() => contactFor.mockReset())

  it('is undefined for an error that is not the refusal', async () => {
    expect(await findUsedInvitation(agentWith() as any, new Error('network'))).toBeUndefined()
  })

  it('opens the contact page for a relationship the invitation made', async () => {
    const contact = { issuer: { id: 'did:peer:alice', name: 'Alice' } }
    contactFor.mockResolvedValue(contact)
    const agent = agentWith({ oob: { id: 'oob-1' }, connections: [{ id: 'conn-1', theirLabel: 'alice-wallet' }] })

    const used = await findUsedInvitation(agent as any, refusal('inv-1'))

    expect(agent.modules.didcomm.oob.findByReceivedInvitationId).toHaveBeenCalledWith('inv-1')
    expect(contactFor).toHaveBeenCalledWith(agent, 'conn-1', [])
    expect(used).toEqual({
      invitationId: 'inv-1',
      connectionId: 'conn-1',
      name: 'Alice',
      open: { stack: Stacks.ContactStack, screen: Screens.ContactDetails, params: { contact } },
    })
  })

  it('opens the chat for a connection with no relationship, named as the connection is', async () => {
    contactFor.mockResolvedValue(null)
    const agent = agentWith({ oob: { id: 'oob-1' }, connections: [{ id: 'conn-1', theirLabel: 'Bob' }] })

    const used = await findUsedInvitation(agent as any, refusal('inv-1'))

    expect(used?.name).toBe('Bob')
    expect(used?.open).toEqual({ stack: Stacks.ContactStack, screen: Screens.Chat, params: { connectionId: 'conn-1' } })
  })

  it('follows a reused connection', async () => {
    contactFor.mockResolvedValue(null)
    const agent = agentWith({ oob: { id: 'oob-1', reuseConnectionId: 'conn-0' }, connections: [{ id: 'conn-0' }] })

    expect((await findUsedInvitation(agent as any, refusal('inv-1')))?.connectionId).toBe('conn-0')
    expect(agent.modules.didcomm.connections.findAllByOutOfBandId).not.toHaveBeenCalled()
  })

  it('still names the refusal when no contact is left, or the lookup fails', async () => {
    expect(await findUsedInvitation(agentWith({ oob: { id: 'oob-1' } }) as any, refusal('inv-1'))).toEqual({
      invitationId: 'inv-1',
    })
    const failing = agentWith()
    failing.modules.didcomm.oob.findByReceivedInvitationId.mockRejectedValue(new Error('store closed'))
    expect(await findUsedInvitation(failing as any, refusal('inv-1'))).toEqual({ invitationId: 'inv-1' })
  })
})

describe('telling the person', () => {
  const t = ((key: string, options?: { name?: string }) => (options?.name ? `${key}(${options.name})` : key)) as any

  it('opens the contact and says they are already connected', () => {
    const navigate = jest.fn()
    const used = {
      invitationId: 'inv-1',
      name: 'Alice',
      open: { stack: Stacks.ContactStack as const, screen: Screens.Chat as const, params: { connectionId: 'c' } },
    }
    expect(openUsedInvitation(used, { navigate })).toBe(true)
    expect(navigate).toHaveBeenCalledWith(Stacks.ContactStack, { screen: Screens.Chat, params: { connectionId: 'c' } })
    expect(usedInvitationToast(used, t)).toMatchObject({
      text1: 'Scan.InvitationAlreadyUsed',
      text2: 'Scan.InvitationAlreadyUsedConnected(Alice)',
    })
  })

  it('with no contact, opens nothing and asks for a new invitation', () => {
    const navigate = jest.fn()
    expect(openUsedInvitation({ invitationId: 'inv-1' }, { navigate })).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(usedInvitationToast({ invitationId: 'inv-1' }, t).text2).toBe('Scan.InvitationAlreadyUsedAskNew')
  })
})
