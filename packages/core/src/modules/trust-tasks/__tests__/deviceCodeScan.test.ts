/**
 * #30: "Scan its code" on the phone adding another one opens the scanner for a
 * device code, which comes back to that screen instead of being routed as a
 * link (a bare did:key would otherwise be refused as "a key, not an agent").
 */
import { deviceCodeScan } from '../module/deviceCodeScan'

afterEach(() => deviceCodeScan.cancel())

describe('scanning the other phone for its code', () => {
  it('hands a scanned device code back to the screen that asked, once', () => {
    const got = jest.fn()
    deviceCodeScan.request(got)
    expect(deviceCodeScan.pending()).toBe(true)
    expect(deviceCodeScan.claim('did:key:z6MkNewPhone')).toEqual({ taken: true })
    expect(got).toHaveBeenCalledWith('did:key:z6MkNewPhone')
    expect(deviceCodeScan.pending()).toBe(false)
    // Nothing waiting any more: the next scan is the scanner's own business.
    expect(deviceCodeScan.claim('did:key:z6MkOther')).toBeUndefined()
  })

  it('takes the code out of a scanned message too', () => {
    const got = jest.fn()
    deviceCodeScan.request(got)
    deviceCodeScan.claim('Add this code to lab so my phone can use it:\n\ndid:key:z6MkNewPhone\n')
    expect(got).toHaveBeenCalledWith('did:key:z6MkNewPhone')
  })

  it('refuses something that is not a device code, and keeps waiting for one', () => {
    const got = jest.fn()
    deviceCodeScan.request(got)
    expect(deviceCodeScan.claim('https://example.org/not-a-code')).toEqual({ taken: false })
    expect(got).not.toHaveBeenCalled()
    expect(deviceCodeScan.pending()).toBe(true)
  })

  it('is not waiting after the screen that asked gives up', () => {
    deviceCodeScan.request(jest.fn())
    deviceCodeScan.cancel()
    expect(deviceCodeScan.claim('did:key:z6MkNewPhone')).toBeUndefined()
  })
})
