/**
 * Photos on their way are kept in memory per chat, never stored: added when picked, changed as they go, and gone
 * once sent or deleted. The screen reads them through usePendingPhotos.
 */
import { act, renderHook } from '@testing-library/react-native'

import {
  addPendingPhoto,
  pendingPhoto,
  removePendingPhoto,
  resetPendingPhotos,
  updatePendingPhoto,
  usePendingPhotos,
} from '../pending'

const photo = { uri: 'file:///cache/IMG.jpg', width: 4032, height: 3024 }

beforeEach(() => resetPendingPhotos())

describe('photos on their way', () => {
  it('a picked photo is shown at once, as being made ready, in its own chat only', () => {
    const id = addPendingPhoto('conn-1', photo, 1000)
    expect(pendingPhoto('conn-1', id)).toMatchObject({ ...photo, stage: 'preparing', createdAt: 1000 })
    expect(pendingPhoto('conn-2', id)).toBeUndefined()
  })

  it('the screen sees each change, and the photo leaves once it is sent or deleted', () => {
    const { result } = renderHook(() => usePendingPhotos('conn-1'))
    expect(result.current).toEqual([])
    let id = ''
    act(() => {
      id = addPendingPhoto('conn-1', photo)
    })
    expect(result.current.map((p) => p.stage)).toEqual(['preparing'])
    act(() => updatePendingPhoto('conn-1', id, { stage: 'failed' }))
    expect(result.current.map((p) => p.stage)).toEqual(['failed'])
    act(() => removePendingPhoto('conn-1', id))
    expect(result.current).toEqual([])
  })

  it('a photo that is gone stays gone: a late update does not bring it back', () => {
    const id = addPendingPhoto('conn-1', photo)
    removePendingPhoto('conn-1', id)
    updatePendingPhoto('conn-1', id, { stage: 'sending' })
    expect(pendingPhoto('conn-1', id)).toBeUndefined()
  })
})
