/**
 * A community's look, for the Wallet's cards and the community's screen: unknown until the phone has read what it keeps (and, for a community with a
 * logo, whether that logo is here), then known for good. A card shows a neutral face while it is unknown, never the
 * default look first and the community's own a moment later; known without a colour or logo is the DID's colour and
 * the monogram, and that is final too.
 *
 * Every card reads the same kept looks, read once and again whenever one is kept (a manifest read). Whether a
 * community's logo is on the phone is settled once per logo and remembered for the run, so a card the Wallet has
 * shown before draws its look on the first frame of every visit, never the neutral face first (272: a pass flashed
 * grey each time the tab came back).
 *
 * @module trust-tasks/module/useCommunityBrand
 */
import { useAgent } from '@bifold/react-hooks'
import type { Agent } from '@credo-ts/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { COMMUNITY_BRAND_EVENT } from './communityChanged'
import { communityBrand, type CommunityBrand, type CommunityBrandRecord } from './communityBrand'
import { cachedCommunityLogo } from './communityLogo'
import { GenericRecordsCommunityStore } from './VtiCommunityStore'

export type Known<T> = { known: false } | { known: true; value: T }

let kept: ReadonlyMap<string, CommunityBrandRecord> | undefined
let reading: Promise<void> | undefined
/** A look was kept while a read was under way: that read may have missed it, so read once more after it. */
let again = false
const listeners = new Set<() => void>()
/** Each logo's settled answer, by community and address: the local file, or undefined when there is none. */
const settledLogos = new Map<string, string | undefined>()

function read(agent: Agent): Promise<void> {
  if (reading) {
    again = true
    return reading
  }
  reading = new GenericRecordsCommunityStore(agent)
    .listCommunityBrands()
    .then((records) => new Map(records.map((record) => [record.communityDid, record])))
    // A failed read is "none kept": every card takes its DID's colour rather than staying neutral for ever.
    .catch(() => kept ?? new Map<string, CommunityBrandRecord>())
    .then((map) => {
      kept = map
      listeners.forEach((listener) => listener())
    })
    .finally(() => {
      reading = undefined
      if (again) {
        again = false
        void read(agent)
      }
    })
  return reading
}

/** Forget the kept looks read so far (tests). */
export function resetCommunityBrands(): void {
  kept = undefined
  reading = undefined
  again = false
  settledLogos.clear()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Whether the phone has heard from `communityDid` about its look, even that it has none (`saveCommunityBrand` keeps
 * that too). A card takes never heard as final; a screen reading the community can wait for what it answers. Only
 * {@link useCommunityBrand} reads the kept looks, so use this beside it: alone it stays false.
 */
export function useCommunityBrandHeard(communityDid: string): boolean {
  return useSyncExternalStore(subscribe, () => !!kept?.has(communityDid))
}

/** The look of `communityDid`'s cards; `name` is what it calls itself, when known (for the monogram). */
export function useCommunityBrand(communityDid: string | undefined, name?: string): Known<CommunityBrand> {
  const { agent } = useAgent()
  const records = useSyncExternalStore(subscribe, () => kept)
  // Bumped when a logo's answer lands, so the card reads it from settledLogos.
  const [, setLogoSettled] = useState(0)

  useEffect(() => {
    if (!agent) return
    if (!kept) void read(agent)
    const subscription = DeviceEventEmitter.addListener(COMMUNITY_BRAND_EVENT, () => void read(agent))
    return () => subscription.remove()
  }, [agent])

  const record = communityDid ? records?.get(communityDid) : undefined
  const logoUrl = record?.logoUrl
  const logoKey = communityDid && logoUrl ? `${communityDid}|${logoUrl}` : undefined
  const settled = !!records && (!logoKey || settledLogos.has(logoKey))

  useEffect(() => {
    if (!communityDid || !logoUrl || !logoKey || settled) return
    let live = true
    void cachedCommunityLogo(communityDid, logoUrl)
      // A logo that cannot be had is no logo: the card shows its monogram rather than staying neutral.
      .catch(() => undefined)
      .then((file) => {
        settledLogos.set(logoKey, file)
        if (live) setLogoSettled((n) => n + 1)
      })
    return () => {
      live = false
    }
  }, [communityDid, logoUrl, logoKey, settled])

  if (!communityDid || !records || !settled) return { known: false }
  return {
    known: true,
    value: communityBrand({
      communityDid,
      name,
      accentColor: record?.accentColor,
      logo: logoKey ? settledLogos.get(logoKey) : undefined,
    }),
  }
}
