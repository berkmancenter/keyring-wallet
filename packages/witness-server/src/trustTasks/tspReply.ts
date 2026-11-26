/**
 * The witness answers a TSP request in the version the request was framed
 * with (TSP 1.0 cutover plan §6.1, B5). A phone on a TSP 1.0 build gets a 1.0
 * reply; a phone still on Rev 3 gets Rev 3, as before. Reading both versions
 * comes from `tsp.unpack`, which dispatches on the version marker.
 *
 * A Rev 2 request is answered in Rev 3, as it was before this change: Rev 2 is
 * read only so that an old frame is reported rather than refused.
 */
import { tsp } from '@bifold/trust-tasks'

export function packTspReply(
  body: Uint8Array,
  myDid: string,
  theirDid: string,
  identity: Pick<tsp.TspIdentity, 'signingKey'>,
  resolver: tsp.VidResolver,
  requestRevision?: tsp.TspRevision
): Promise<tsp.PackedMessage> {
  if (requestRevision === 'v1') return tsp.packV1(body, myDid, theirDid, identity, resolver)
  return tsp.packRev3(body, myDid, theirDid, identity, resolver)
}
