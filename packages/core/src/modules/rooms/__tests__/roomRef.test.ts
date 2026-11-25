/**
 * What tells a room the community named none apart (276.9): the DID's last path segment whole, else the end of its
 * SCID after "…". Never its last 10 characters, which cut "community-a-vtc" to "nity-a-vtc".
 */
import { roomRef } from '../roomRef'

describe('roomRef', () => {
  test.each([
    ['its last path segment, whole', 'did:webvh:QmScid123456:rooms.example:community-a-vtc', 'community-a-vtc'],
    ['decoded', 'did:webvh:QmScid123456:rooms.example:garden%20plans', 'garden plans'],
    ['no path: the end of its SCID, said to be cut', 'did:webvh:QmScid123456:rooms.example', '…123456'],
    ['not a did:webvh: its end, said to be cut', 'urn:uuid:0f3c2a9e-77aa-4b1e-9d1c-5be0c1a2b3c4', '…a2b3c4'],
    ['a path that will not decode: the end of its SCID', 'did:webvh:QmScid123456:rooms.example:%E0%A4%A', '…123456'],
  ])('%s', (_, roomId, ref) => {
    expect(roomRef(roomId)).toBe(ref)
  })
})
