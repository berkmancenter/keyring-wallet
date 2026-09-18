import { renderHook } from '@testing-library/react-native'
import { Agent } from '@credo-ts/core'

import { useRCardCredential } from '../../../../src/modules/vrc/hooks/useRCardCredential'
import { useStore } from '../../../../src/contexts/store'
import { DispatchAction } from '../../../../src/contexts/reducers/store'
import { buildRCardTemplate } from '../../../../src/modules/vrc/types/rcard'
import * as rCardCredentialService from '../../../../src/modules/vrc/services/rCardCredential'

const mockAgent = {
  context: {},
  config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
} as unknown as Agent
const mockDispatch = jest.fn()

jest.mock('@bifold/react-hooks', () => ({
  useAgent: jest.fn(() => ({ agent: mockAgent })),
}))

jest.mock('../../../../src/contexts/store', () => ({
  useStore: jest.fn(),
}))

const existingTemplate = buildRCardTemplate({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  organization: 'Old Org',
})

describe('useRCardCredential().update', () => {
  let updateSpy: jest.SpyInstance
  let loadSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useStore as jest.Mock).mockReturnValue([
      { rCard: { template: existingTemplate, lastSyncedAt: '2026-01-01T00:00:00.000Z' } },
      mockDispatch,
    ])
    updateSpy = jest.spyOn(rCardCredentialService, 'updateRCardTemplate')
    loadSpy = jest.spyOn(rCardCredentialService, 'loadRCardTemplate')
  })

  afterEach(() => {
    updateSpy.mockRestore()
    loadSpy.mockRestore()
  })

  test('validates, persists and dispatches the reloaded template on success', async () => {
    const updatedTemplate = { ...existingTemplate, jcard: ['vcard', []] as ['vcard', never[]] }
    updateSpy.mockResolvedValue(true)
    loadSpy.mockResolvedValue(updatedTemplate)

    const { result } = renderHook(() => useRCardCredential())

    const outcome = await result.current.update({
      firstName: 'Janet',
      lastName: 'Doerson',
      email: 'janet@example.com',
      organization: 'New Org',
    })

    expect(outcome).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      existingTemplate.templateId,
      expect.objectContaining({ firstName: 'Janet' }),
      mockAgent
    )
    expect(mockDispatch).toHaveBeenCalledWith({
      type: DispatchAction.R_CARD_CREDENTIAL_SYNCED,
      payload: [updatedTemplate],
    })
  })

  test('a validation failure calls neither storage nor dispatch', async () => {
    const { result } = renderHook(() => useRCardCredential())

    const outcome = await result.current.update({ firstName: '', lastName: '', email: '', organization: '' })

    expect(outcome).toBe(false)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  test('returns false without dispatching when there is no profile to edit', async () => {
    ;(useStore as jest.Mock).mockReturnValue([{ rCard: { template: undefined } }, mockDispatch])

    const { result } = renderHook(() => useRCardCredential())

    const outcome = await result.current.update({
      firstName: 'Janet',
      lastName: 'Doerson',
      email: '',
      organization: '',
    })

    expect(outcome).toBe(false)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(mockDispatch).not.toHaveBeenCalled()
  })
})
