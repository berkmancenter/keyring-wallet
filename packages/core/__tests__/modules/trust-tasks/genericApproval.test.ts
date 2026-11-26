import type { Agent } from '@credo-ts/core'

import { createApprovalRequestHandler } from '../../../src/modules/trust-tasks/genericApproval'
import { trustTaskPromptStore } from '../../../src/modules/trust-tasks/trustTaskPromptStore'
import * as vrcNameHelper from '../../../src/modules/vrc/utils/vrcNameHelper'

jest.mock('../../../src/modules/vrc/utils/vrcNameHelper')

const mockGetVrcNameForConnection = vrcNameHelper.getVrcNameForConnection as jest.MockedFunction<
  typeof vrcNameHelper.getVrcNameForConnection
>

describe('createApprovalRequestHandler — counterparty label resolution', () => {
  const CONNECTION_ID = 'connection-1'
  const DOCUMENT = { id: 'doc-1', type: 'https://example.org/spec/x/0.1', payload: { resource: 'a thing' } }

  const buildAgent = (theirLabel: string | undefined): Agent =>
    ({
      context: {},
      config: { logger: { warn: jest.fn(), info: jest.fn() } },
      modules: {
        didcomm: {
          connections: {
            getById: jest.fn().mockResolvedValue({ theirLabel }),
          },
        },
      },
      w3cCredentials: { getAll: jest.fn().mockResolvedValue([]) },
    }) as unknown as Agent

  const buildService = () => ({ consume: jest.fn().mockResolvedValue({ kind: 'accepted' }) })

  const runHandler = async (theirLabel: string | undefined) => {
    const agent = buildAgent(theirLabel)
    const handler = createApprovalRequestHandler({ spec: {} as never, summarize: () => 'summary' })
    await handler(agent, buildService() as never, DOCUMENT, { connectionId: CONNECTION_ID } as never)
    return trustTaskPromptStore.getPending(CONNECTION_ID, DOCUMENT.type)?.counterpartyLabel
  }

  beforeEach(() => {
    trustTaskPromptStore.clear()
    jest.clearAllMocks()
  })

  it('prefers the VRC contact name over the connection label', async () => {
    mockGetVrcNameForConnection.mockResolvedValue('Alice Smith')

    expect(await runHandler('some-wallet-label')).toBe('Alice Smith')
  })

  it('falls back to the connection label when no VRC name resolves', async () => {
    mockGetVrcNameForConnection.mockResolvedValue(null)

    expect(await runHandler('some-wallet-label')).toBe('some-wallet-label')
  })

  it('falls back to "Unknown Contact" when neither is available', async () => {
    mockGetVrcNameForConnection.mockResolvedValue(null)

    expect(await runHandler(undefined)).toBe('Unknown Contact')
  })

  it('falls back to the connection label if VRC name resolution throws', async () => {
    mockGetVrcNameForConnection.mockRejectedValue(new Error('boom'))

    expect(await runHandler('some-wallet-label')).toBe('some-wallet-label')
  })
})
