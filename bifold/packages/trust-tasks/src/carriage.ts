/**
 * Carriage — the port a Trust Task document moves over, kept independent of
 * any specific transport (openvtc-integration-plan.md §5.2: "The task model
 * depends on a `Carriage` port, not on the TSP wire"). Today the only
 * implementation is DIDComm v1 (`packages/core`'s `DidCommV1Carriage`,
 * binding-0.2); a future TSP carriage implements the same port without this
 * package, or anything built against it, changing.
 *
 * @module trust-tasks/carriage
 */

/** The transport-authenticated peer a document was sent to or received from. */
export interface CarriagePeer {
  connectionId: string
  senderDid?: string
  recipientDid?: string
}

/** The handler a carriage invokes for every inbound Trust Task document. */
export type CarriageDocumentHandler = (
  document: Record<string, unknown>,
  peer: Partial<CarriagePeer>
) => void | Promise<void>

export interface Carriage {
  /** Send a Trust Task document to a peer. */
  send(document: Record<string, unknown>, peer: CarriagePeer): Promise<void>
  /** Register the handler for inbound documents. One handler per carriage instance. */
  onDocument(handler: CarriageDocumentHandler): void
}
