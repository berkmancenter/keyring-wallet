/**
 * Verify-only did:webs (DBI plan Phase 2; keri-holder plan S4): see ./README.md for what it checks and what it does not.
 *
 * @module sedi/webs
 */
export { artifactUrl, didWebTwin, parseWebsDid, type WebsDid } from './identifier'
export { checkDocument, jwkOf, publishedDocument, type Jwk } from './document'
export {
  WEBS_LIMITS,
  resolveWebs,
  type WebsFetch,
  type WebsLimits,
  type WebsRefusal,
  type WebsRefusalReason,
  type WebsResolution,
  type WebsResponse,
} from './resolve'
export { verifyGuardianWithWebs, type StateNotResolved, type WebsRoot } from './guardian'
