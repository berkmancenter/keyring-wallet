/**
 * The release app's App Transport Security stays closed: plain HTTP to
 * `localhost` only. The push-test build adds local networking for one build
 * (scripts/push-test/build-ios.sh restores the file afterwards), so this fails
 * if that change ever reaches the committed Info.plist.
 */
import fs from 'fs'
import path from 'path'

const INFO_PLIST = path.join(__dirname, '..', '..', 'ios', 'AriesBifold', 'Info.plist')

describe("the release app's App Transport Security", () => {
  const plist = fs.readFileSync(INFO_PLIST, 'utf8')

  it('does not allow local networking', () => {
    expect(plist).not.toContain('NSAllowsLocalNetworking')
  })

  it('does not allow arbitrary loads', () => {
    expect(plist).toMatch(/<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/)
  })
})
