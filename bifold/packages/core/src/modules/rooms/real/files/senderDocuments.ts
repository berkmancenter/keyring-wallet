/**
 * A file author's DID document, for checking who shared a file (`sender.ts`). Fetching a did:webvh tells the
 * author's host that this phone is reading, and when, so each author's is asked for at most once until the wallet
 * locks.
 *
 * @module rooms/real/files/senderDocuments
 */
import type { Agent } from '@credo-ts/core'
import { DeviceEventEmitter } from 'react-native'

import { WALLET_LOCKED_EVENT } from '../../../../utils/walletLocked'

import { DOCUMENT_TIMEOUT, type ResolveSender, type SenderDidDocument } from './sender'

/** How long a file's author's DID document is waited for before who shared it is left unconfirmed. */
export const SENDER_RESOLVE_MS = 5000

// Each file author's DID document, asked for once until the wallet locks: fetching a did:webvh tells the author's host
// that this phone is reading, and when. One that could not be had stays that way until the lock, so the host is not
// asked again either; who shared that author's files is unconfirmed until then.
const senders = new Map<string, Promise<SenderDidDocument>>()
DeviceEventEmitter.addListener(WALLET_LOCKED_EVENT, () => senders.clear())

/** A file author's DID document through the agent's resolvers (did:webvh among them), at most once per author. */
export function senderResolver(agent: Agent): ResolveSender {
  return (did) => {
    let asked = senders.get(did)
    if (!asked) {
      let timer: ReturnType<typeof setTimeout> | undefined
      asked = Promise.race([
        agent.dids.resolveDidDocument(did) as Promise<SenderDidDocument>,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(new Error(`no DID document within ${SENDER_RESOLVE_MS} ms`), { name: DOCUMENT_TIMEOUT })
              ),
            SENDER_RESOLVE_MS
          )
        }),
      ]).finally(() => clearTimeout(timer))
      senders.set(did, asked)
    }
    return asked
  }
}
