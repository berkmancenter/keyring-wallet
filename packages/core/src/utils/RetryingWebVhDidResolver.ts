import type { AgentContext, DidResolutionResult } from '@credo-ts/core'
import { WebVhDidResolver } from '@credo-ts/webvh'

/**
 * `did:webvh` resolution that retries a `421 Misdirected Request`.
 *
 * A 421 means the client sent the request on a connection it opened for
 * another host behind the same certificate and address (HTTP/2 coalescing),
 * and the server wants it on a fresh one — RFC 9110 §15.5.20 allows the
 * retry. iOS coalesces across hosts that share a wildcard certificate, so a
 * lab whose DIDs live on several `*.ngrok.app` hosts meets it intermittently:
 * on 2026-09-22 it failed a persona mint at "Unable to resolve did document …
 * HTTP error! status: 421", the same fault the status-list fetch already
 * retries. `didwebvh-ts` does its own fetching and reports the status only in
 * its message, so that is what is read here.
 */
export class RetryingWebVhDidResolver extends WebVhDidResolver {
  public async resolve(agentContext: AgentContext, did: string): Promise<DidResolutionResult> {
    const first = await super.resolve(agentContext, did)
    if (!isMisdirected(first)) return first
    agentContext.config.logger.debug(`did:webvh resolution of ${did} was misdirected (421); retrying once`)
    return super.resolve(agentContext, did)
  }
}

export function isMisdirected(result: DidResolutionResult): boolean {
  const message = result.didResolutionMetadata?.message
  return !result.didDocument && typeof message === 'string' && /\bstatus:? 421\b/.test(message)
}
