/**
 * A persona made with openvtc as did:scid (openvtc #503) is listed by its agent
 * as the did:webvh of its log, while its community may issue its card to the
 * did:scid:vh:1 form. Both carry one SCID: one identity (VTI-KEY-160; the
 * vectors follow vta-sdk `did_scid.rs` at vta-service-v0.65.0).
 */
import { sameIdentity, scidOf } from '../module/didScid'

describe('the SCID of a DID', () => {
  it('reads it from either form, without src, query or fragment', () => {
    expect(scidOf('did:webvh:QmA:example.com:alice')).toBe('QmA')
    expect(scidOf('did:webvh:QmA:example.com#key-1')).toBe('QmA')
    expect(scidOf('did:scid:vh:1:QmA')).toBe('QmA')
    expect(scidOf('did:scid:vh:1:QmA?src=example.com/alice#key-1')).toBe('QmA')
  })

  it('has none for another method, or a malformed one', () => {
    expect(scidOf('did:web:example.com')).toBeUndefined()
    expect(scidOf('did:peer:2.Ez')).toBeUndefined()
    expect(scidOf('did:webvh:QmA')).toBeUndefined()
    expect(scidOf('did:scid:vh:1:')).toBeUndefined()
  })
})

describe('one identity', () => {
  it('a did:scid:vh:1 and the did:webvh of its log', () => {
    expect(sameIdentity('did:webvh:QmA:example.com:alice', 'did:scid:vh:1:QmA?src=example.com/alice')).toBe(true)
    expect(sameIdentity('did:scid:vh:1:QmA', 'did:webvh:QmA:example.com:alice')).toBe(true)
  })

  it('two did:scid:vh:1 that differ only in src', () => {
    expect(sameIdentity('did:scid:vh:1:QmA?src=a.example', 'did:scid:vh:1:QmA?src=b.example')).toBe(true)
  })

  it('not another SCID, and two did:webvh only when they are the same DID', () => {
    expect(sameIdentity('did:webvh:QmA:example.com', 'did:scid:vh:1:QmB')).toBe(false)
    expect(sameIdentity('did:webvh:QmA:example.com', 'did:webvh:QmA:other.example')).toBe(false)
    expect(sameIdentity('did:webvh:QmA:example.com', 'did:webvh:QmA:example.com')).toBe(true)
    expect(sameIdentity('did:web:example.com', 'did:scid:vh:1:example.com')).toBe(false)
  })
})
