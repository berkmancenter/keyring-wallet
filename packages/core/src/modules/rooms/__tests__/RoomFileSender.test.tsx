/**
 * Who shared a file, as the library row and the attachment sheet say it (ROOM-FILE-SHARED-BY): named only once the
 * record's signature holds; "sender not confirmed" while it could not be checked; and a file whose signature does not
 * hold says it can't be opened, with nothing to download.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { RoomFileSheet } from '../components/RoomFileSheet'
import { FileRow } from '../components/RoomListRows'
import { toInertText } from '../inertText'
import type { RoomFile } from '../types'

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: { CachesDirectoryPath: '/caches', unlink: jest.fn(async () => undefined) },
}))

const id = (key: string) => testIdWithKey(key)
const file = (over: Partial<RoomFile>): RoomFile => ({
  fileId: 'f1',
  name: toInertText('minutes.pdf'),
  mediaType: 'application/pdf',
  size: 1234,
  sharedAt: '2026-10-30T09:00:00Z',
  ...over,
})
const ALICE = { did: 'did:webvh:alice.example' }

const row = (f: RoomFile) =>
  render(
    <BasicAppContext>
      <FileRow file={f} onPress={() => undefined} />
    </BasicAppContext>
  ).getByTestId(id('RoomFileRow_f1'))

const sheet = (f: RoomFile) =>
  render(
    <BasicAppContext>
      <RoomFileSheet service={undefined} roomId="did:webvh:room:a" file={f} onClose={() => undefined} />
    </BasicAppContext>
  )

describe('who shared a file, as the screens say it', () => {
  test('confirmed: the sharer is named, and the file can be downloaded', () => {
    const f = file({ sender: 'confirmed', sharedBy: ALICE })
    expect(row(f)).toHaveTextContent(/Rooms\.FileSharedBy/)
    const tree = sheet(f)
    expect(tree.getByTestId(id('RoomFileShared'))).toHaveTextContent(/Rooms\.FileSharedBy/)
    expect(tree.getByTestId(id('RoomFileDownload'))).toBeTruthy()
    expect(tree.getByTestId(id('RoomFileCaution'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomFileNotConfirmed'))).toBeNull()
  })

  test('unconfirmed: no one is named, the line says so, and the file can still be downloaded', () => {
    const f = file({ sender: 'unconfirmed' })
    const r = row(f)
    expect(r).toHaveTextContent(/Rooms\.FileSenderNotConfirmed/)
    expect(r).not.toHaveTextContent(/Rooms\.FileSharedBy/)
    const tree = sheet(f)
    expect(tree.getByTestId(id('RoomFileShared'))).toHaveTextContent(/Rooms\.FileSenderNotConfirmed/)
    expect(tree.getByTestId(id('RoomFileDownload'))).toBeTruthy()
    expect(tree.getByTestId(id('RoomFileCaution'))).toBeTruthy()
  })

  test('a name passed with an unconfirmed sender is still not shown', () => {
    const f = file({ sender: 'unconfirmed', sharedBy: ALICE })
    expect(row(f)).not.toHaveTextContent(/Rooms\.FileSharedBy/)
    expect(sheet(f).getByTestId(id('RoomFileShared'))).not.toHaveTextContent(/Rooms\.FileSharedBy/)
  })

  test('refused: the file can’t be opened, there is nothing to download, and no caution asks to trust who shared it', () => {
    const f = file({ sender: 'refused', sharedBy: ALICE })
    const r = row(f)
    expect(r).toHaveTextContent(/Rooms\.FileNotConfirmed/)
    expect(r).not.toHaveTextContent(/Rooms\.FileSharedBy/)
    const tree = sheet(f)
    expect(tree.getByTestId(id('RoomFileNotConfirmed'))).toHaveTextContent('Rooms.FileNotConfirmed')
    expect(tree.queryByTestId(id('RoomFileDownload'))).toBeNull()
    expect(tree.queryByTestId(id('RoomFileShared'))).toBeNull()
    expect(tree.queryByTestId(id('RoomFileCaution'))).toBeNull()
    expect(tree.queryByText('Rooms.FileCaution')).toBeNull()
  })
})
