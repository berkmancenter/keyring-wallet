/**
 * A badge card's picture in the Wallet (docs/plans/member-badges-plan.md, Wallet; Interfaces, Images).
 *
 * The badge's credential names its picture but never carries it: `achievement.image.id` is `urn:sha256:<digest>`, or a
 * public URL for a badge its holders may show outside (VTI vtc-service `badges/credential.rs`, `achievement`). The
 * picture is asked of the member's own community with `images/get` (the badge service), never fetched from that URL
 * (the view carries none: `badgeCardView` exposes no URL), so the Wallet never contacts anything but the community the
 * badge came from:
 *
 * - with the digest the credential names, `image` once;
 * - without one, `show` first for the badge's digest, then `image`;
 * - only a `data:image/…` answer is drawn. Anything else (a URL included) draws the card's own mark instead, so no
 *   picture is ever loaded from the network by the image view.
 *
 * Nothing is asked while badges are off: `useBadgeService` then gives no service (`badgesSwitch`), and the card that
 * draws the picture draws nothing.
 *
 * @module badges/wallet/useBadgePicture
 */
import { useEffect, useState } from 'react'

import type { BadgeCardView } from '../../trust-tasks/module/badgeCredentials'
import { useBadgeService } from '../useBadges'

/** What the card needs to ask for its picture: its community, and its badge and digest when the credential names them. */
export type BadgePictureSource = Pick<BadgeCardView, 'communityDid' | 'badgeId' | 'imageSha256'>

/** A picture the image view may draw: a data URI of an image, never a location. */
export const isDrawablePicture = (uri: unknown): uri is string =>
  typeof uri === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(uri)

export function useBadgePicture(source: BadgePictureSource): string | undefined {
  const service = useBadgeService()
  const { communityDid, badgeId, imageSha256 } = source
  const [fetched, setFetched] = useState<{ key: string; uri: string }>()
  const key = `${communityDid}|${badgeId ?? ''}|${imageSha256 ?? ''}`

  useEffect(() => {
    if (!service || !badgeId) return
    let live = true
    const ask = async () => {
      let sha = imageSha256
      if (!sha) {
        const summary = await service.show(communityDid, badgeId)
        sha = summary === 'notServed' ? undefined : summary.image?.sha256
      }
      if (!sha || !live) return
      const uri = await service.image(communityDid, badgeId, sha)
      if (live && isDrawablePicture(uri)) setFetched({ key, uri })
    }
    // A picture that can't be had leaves the card's own mark; the next time the card is drawn asks again.
    ask().catch(() => undefined)
    return () => {
      live = false
    }
  }, [service, communityDid, badgeId, imageSha256, key])

  return fetched?.key === key ? fetched.uri : undefined
}
