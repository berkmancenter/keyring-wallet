/**
 * A community's logo, fetched once and kept on the phone, so opening the Wallet does not reach every community's host
 * each time. Keyed by the community and the address together: a community that changes its logo gets the new one, and
 * one community can never show another's.
 *
 * Only an https address (communityBrand.ts `httpsLogoUrl`) is fetched, and only a PNG, JPEG or WebP image no larger
 * than {@link MAX_LOGO_BYTES} is kept; anything else, and any failure, means no logo, and the card shows its monogram.
 * A failure is remembered until the app restarts, so a host that is down is not asked again on every render.
 *
 * @module trust-tasks/module/communityLogo
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import RNFS from 'react-native-fs'

import { httpsLogoUrl } from './communityBrand'

export const MAX_LOGO_BYTES = 512 * 1024
const IMAGE_TYPE = /^image\/(png|jpeg|webp)(;|$)/i

const logoDir = () => `${RNFS.CachesDirectoryPath}/community-logos`
const settled = new Map<string, Promise<string | undefined>>()

/** Forget what this run has fetched or failed to (tests). */
export function resetCommunityLogos(): void {
  settled.clear()
}

const headerOf = (headers: Record<string, string> | undefined, name: string) =>
  Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1]

async function fetchLogo(url: string, path: string): Promise<string | undefined> {
  const part = `${path}.part`
  let refused = false
  try {
    await RNFS.mkdir(logoDir())
    const job = RNFS.downloadFile({
      fromUrl: url,
      toFile: part,
      begin: (res) => {
        const type = headerOf(res.headers, 'content-type') ?? ''
        if (res.statusCode !== 200 || !IMAGE_TYPE.test(type) || res.contentLength > MAX_LOGO_BYTES) {
          refused = true
          RNFS.stopDownload(job.jobId)
        }
      },
    })
    const result = await job.promise
    if (refused || result.statusCode !== 200 || result.bytesWritten === 0 || result.bytesWritten > MAX_LOGO_BYTES) {
      await RNFS.unlink(part).catch(() => undefined)
      return undefined
    }
    await RNFS.moveFile(part, path)
    return `file://${path}`
  } catch {
    await RNFS.unlink(part).catch(() => undefined)
    return undefined
  }
}

/** The local copy of `communityDid`'s logo at `url` (a `file://` address), fetching it the first time; else undefined. */
export function cachedCommunityLogo(communityDid: string, url: string | undefined): Promise<string | undefined> {
  const address = httpsLogoUrl(url)
  if (!communityDid || !address) return Promise.resolve(undefined)
  const key = bytesToHex(sha256(utf8ToBytes(`${communityDid}\n${address}`)))
  const known = settled.get(key)
  if (known) return known
  const path = `${logoDir()}/${key}`
  const pending = RNFS.exists(path)
    .then((kept) => (kept ? `file://${path}` : fetchLogo(address, path)))
    .catch(() => undefined)
  settled.set(key, pending)
  return pending
}
