import { renderHook, waitFor } from '@testing-library/react-native'
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

const profileA = buildRCardTemplate({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  organization: 'Personal',
})
const profileB = buildRCardTemplate({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@work.example.com',
  organization: 'Work',
})

const mockState = (overrides?: { profiles?: typeof profileA[]; activeProfileId?: string }) => ({
  rCard: {
    profiles: overrides?.profiles ?? [profileA, profileB],
    activeProfileId: overrides?.activeProfileId ?? profileA.id,
    lastSyncedAt: '2026-01-01T00:00:00.000Z',
  },
})

describe('useRCardCredential', () => {
  let updateSpy: jest.SpyInstance
  let loadSpy: jest.SpyInstance
  let storeSpy: jest.SpyInstance
  let deleteSpy: jest.SpyInstance
  let setActiveSpy: jest.SpyInstance
  let adoptLegacySpy: jest.SpyInstance
  let loadAllSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useStore as jest.Mock).mockReturnValue([mockState(), mockDispatch])
    updateSpy = jest.spyOn(rCardCredentialService, 'updateRCardTemplate')
    loadSpy = jest.spyOn(rCardCredentialService, 'loadRCardTemplate')
    storeSpy = jest.spyOn(rCardCredentialService, 'storeRCardTemplate')
    deleteSpy = jest.spyOn(rCardCredentialService, 'deleteRCardTemplate').mockResolvedValue(undefined)
    setActiveSpy = jest.spyOn(rCardCredentialService, 'setActiveRCardProfile')
    adoptLegacySpy = jest.spyOn(rCardCredentialService, 'adoptLegacyRCardTemplate').mockResolvedValue(undefined)
    loadAllSpy = jest.spyOn(rCardCredentialService, 'loadAllRCardTemplates')
  })

  afterEach(() => {
    updateSpy.mockRestore()
    loadSpy.mockRestore()
    storeSpy.mockRestore()
    deleteSpy.mockRestore()
    setActiveSpy.mockRestore()
    adoptLegacySpy.mockRestore()
    loadAllSpy.mockRestore()
  })

  test('template/profiles/activeProfileId reflect the active profile from state', () => {
    const { result } = renderHook(() => useRCardCredential())
    expect(result.current.template).toEqual(profileA)
    expect(result.current.profiles).toEqual([profileA, profileB])
    expect(result.current.activeProfileId).toBe(profileA.id)
  })

  describe('update', () => {
    test('validates, persists and dispatches the reloaded template on success', async () => {
      const updatedProfileA = { ...profileA, jcard: ['vcard', []] as ['vcard', never[]] }
      updateSpy.mockResolvedValue(true)
      loadSpy.mockResolvedValue(updatedProfileA)

      const { result } = renderHook(() => useRCardCredential())

      const outcome = await result.current.update(profileA.templateId, {
        firstName: 'Janet',
        lastName: 'Doerson',
        email: 'janet@example.com',
        organization: 'New Org',
      })

      expect(outcome).toBe(true)
      expect(updateSpy).toHaveBeenCalledWith(
        profileA.templateId,
        expect.objectContaining({ firstName: 'Janet' }),
        mockAgent
      )
      expect(loadSpy).toHaveBeenCalledWith(mockAgent, profileA.templateId)
      expect(mockDispatch).toHaveBeenCalledWith({
        type: DispatchAction.R_CARD_CREDENTIAL_SYNCED,
        payload: [updatedProfileA],
      })
    })

    test('a validation failure calls neither storage nor dispatch', async () => {
      const { result } = renderHook(() => useRCardCredential())

      const outcome = await result.current.update(profileA.templateId, {
        firstName: '',
        lastName: '',
        email: '',
        organization: '',
      })

      expect(outcome).toBe(false)
      expect(updateSpy).not.toHaveBeenCalled()
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    test('returns false without dispatching when the profile no longer exists to update', async () => {
      updateSpy.mockResolvedValue(false)
      const { result } = renderHook(() => useRCardCredential())

      const outcome = await result.current.update('no-such-profile', {
        firstName: 'A',
        lastName: 'B',
        email: '',
        organization: '',
      })

      expect(outcome).toBe(false)
      expect(loadSpy).not.toHaveBeenCalled()
      expect(mockDispatch).not.toHaveBeenCalled()
    })
  })

  describe('create', () => {
    test('validates, persists and dispatches the new profile', async () => {
      storeSpy.mockResolvedValue(true)
      const { result } = renderHook(() => useRCardCredential())

      const created = await result.current.create({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'personal2@example.com',
        organization: 'Side Project',
      })

      expect(created).toBeDefined()
      expect(storeSpy).toHaveBeenCalledWith(created, mockAgent)
      expect(mockDispatch).toHaveBeenCalledWith({
        type: DispatchAction.R_CARD_CREDENTIAL_SYNCED,
        payload: [created],
      })
    })

    test('a validation failure calls neither storage nor dispatch, and returns undefined', async () => {
      const { result } = renderHook(() => useRCardCredential())

      const created = await result.current.create({ firstName: '', lastName: '', email: '', organization: '' })

      expect(created).toBeUndefined()
      expect(storeSpy).not.toHaveBeenCalled()
      expect(mockDispatch).not.toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    test('refuses to delete the last remaining profile', async () => {
      ;(useStore as jest.Mock).mockReturnValue([
        mockState({ profiles: [profileA], activeProfileId: profileA.id }),
        mockDispatch,
      ])
      const { result } = renderHook(() => useRCardCredential())

      const outcome = await result.current.remove(profileA.id)

      expect(outcome).toEqual({ ok: false, reason: 'LastProfile' })
      expect(deleteSpy).not.toHaveBeenCalled()
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    test('refuses to delete the active profile, even when others exist', async () => {
      const { result } = renderHook(() => useRCardCredential())

      const outcome = await result.current.remove(profileA.id) // profileA is active per mockState()

      expect(outcome).toEqual({ ok: false, reason: 'ActiveProfile' })
      expect(deleteSpy).not.toHaveBeenCalled()
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    test('deletes a non-active profile when more than one exists', async () => {
      const { result } = renderHook(() => useRCardCredential())

      const outcome = await result.current.remove(profileB.id)

      expect(outcome).toEqual({ ok: true })
      expect(deleteSpy).toHaveBeenCalledWith(mockAgent, profileB.id)
      expect(mockDispatch).toHaveBeenCalledWith({
        type: DispatchAction.R_CARD_PROFILE_DELETED,
        payload: [profileB.id],
      })
    })
  })

  describe('setActive', () => {
    test('sets a known profile active', async () => {
      setActiveSpy.mockResolvedValue(true)
      const { result } = renderHook(() => useRCardCredential())

      const outcome = await result.current.setActive(profileB.id)

      expect(outcome).toBe(true)
      expect(setActiveSpy).toHaveBeenCalledWith(mockAgent, profileB.id)
      expect(mockDispatch).toHaveBeenCalledWith({
        type: DispatchAction.R_CARD_ACTIVE_PROFILE_SET,
        payload: [profileB.id],
      })
    })

    test('refuses a profileId that is not one of this wallet\'s profiles', async () => {
      const { result } = renderHook(() => useRCardCredential())

      const outcome = await result.current.setActive('no-such-profile')

      expect(outcome).toBe(false)
      expect(setActiveSpy).not.toHaveBeenCalled()
      expect(mockDispatch).not.toHaveBeenCalled()
    })
  })

  describe('sync-on-mount effect', () => {
    // lastSyncedAt unset - the condition every one of these tests needs to
    // let the effect run at all (other describe blocks above set it via
    // mockState()'s default, precisely so this effect stays out of their way).
    const unsyncedState = (profiles: typeof profileA[] = []) => ({
      rCard: { profiles, activeProfileId: undefined, lastSyncedAt: undefined },
    })

    test('does nothing when lastSyncedAt is already set', async () => {
      ;(useStore as jest.Mock).mockReturnValue([mockState(), mockDispatch])
      renderHook(() => useRCardCredential())

      await waitFor(() => {
        expect(adoptLegacySpy).not.toHaveBeenCalled()
      })
      expect(loadAllSpy).not.toHaveBeenCalled()
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    test('adopts a legacy record, then loads and dispatches whatever Credo already has', async () => {
      ;(useStore as jest.Mock).mockReturnValue([unsyncedState(), mockDispatch])
      loadAllSpy.mockResolvedValue({ profiles: [profileA, profileB], activeProfileId: profileA.id })

      renderHook(() => useRCardCredential())

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: DispatchAction.R_CARD_PROFILES_LOADED,
          payload: [[profileA, profileB], profileA.id],
        })
      })
      expect(adoptLegacySpy).toHaveBeenCalledWith(mockAgent)
      // adoptLegacyRCardTemplate ran before the read that found these profiles,
      // not after — the whole point is that a legacy record must be adopted
      // in time for this same load to see it correctly tagged.
      expect(adoptLegacySpy.mock.invocationCallOrder[0]).toBeLessThan(loadAllSpy.mock.invocationCallOrder[0])
      expect(storeSpy).not.toHaveBeenCalled()
    })

    test('migrates a pre-agent staged profile to Credo when Credo has nothing yet', async () => {
      ;(useStore as jest.Mock).mockReturnValue([unsyncedState([profileA]), mockDispatch])
      loadAllSpy
        .mockResolvedValueOnce({ profiles: [], activeProfileId: undefined }) // before migration
        .mockResolvedValueOnce({ profiles: [profileA], activeProfileId: profileA.id }) // after
      storeSpy.mockResolvedValue(true)

      renderHook(() => useRCardCredential())

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: DispatchAction.R_CARD_PROFILES_LOADED,
          payload: [[profileA], profileA.id],
        })
      })
      expect(storeSpy).toHaveBeenCalledWith(profileA, mockAgent)
    })

    test('does not dispatch when migrating a staged profile fails to persist, so a retry stays possible', async () => {
      ;(useStore as jest.Mock).mockReturnValue([unsyncedState([profileA]), mockDispatch])
      loadAllSpy.mockResolvedValue({ profiles: [], activeProfileId: undefined })
      storeSpy.mockResolvedValue(false)

      renderHook(() => useRCardCredential())

      await waitFor(() => {
        expect(storeSpy).toHaveBeenCalled()
      })
      expect(mockDispatch).not.toHaveBeenCalled()
    })

    test('does nothing when Credo is empty and nothing is staged', async () => {
      ;(useStore as jest.Mock).mockReturnValue([unsyncedState(), mockDispatch])
      loadAllSpy.mockResolvedValue({ profiles: [], activeProfileId: undefined })

      renderHook(() => useRCardCredential())

      await waitFor(() => {
        expect(loadAllSpy).toHaveBeenCalled()
      })
      expect(storeSpy).not.toHaveBeenCalled()
      expect(mockDispatch).not.toHaveBeenCalled()
    })
  })
})
