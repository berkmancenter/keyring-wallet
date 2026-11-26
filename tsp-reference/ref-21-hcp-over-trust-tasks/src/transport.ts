// Two ways to move a sealed TSP frame between parties:
//  - "mediator": each party authenticates to a real mediator and holds one live-delivery socket,
//    as tsp-reference/ref-04-mediator does. A Direct TSP frame is sent as a raw binary WebSocket
//    frame; the mediator routes on the cleartext envelope's receiver VID.
//  - "loopback": in-memory queues, for a run with no network. Says so in the report.
import { WebSocket } from "ws";
import { authenticateToMediator, MediatorSession } from "@openvtc/vti-didcomm-js";
import type { Identity } from "./identity.ts";

export interface Wire {
  kind: "mediator" | "loopback";
  send(toDid: string, bytes: Uint8Array): void;
  onFrame(cb: (bytes: Uint8Array) => void): void;
  close(): Promise<void>;
}

// The ecosystem's public dev mediator, as re-created on 2026-09-27 (see the README's note on it).
export const DEFAULT_MEDIATOR =
  "did:webvh:QmR5xGk8pkd3ymu7xpfkjr7XZmwDALA5ZJmgG7qcrD2mKA:webvh.storm.ws:mediator";

export async function attachMediator(id: Identity, mediatorDid: string, note: (s: string) => void): Promise<Wire> {
  const auth = await authenticateToMediator({
    mediatorDid,
    clientDid: id.did,
    clientX25519Private: id.xSecret,
    clientX25519Public: id.xPublic,
    allowInsecure: Boolean(process.env.MEDIATOR_ALLOW_INSECURE),
  });
  let cb: ((bytes: Uint8Array) => void) | undefined;
  const early: Uint8Array[] = [];
  const session = new MediatorSession({
    mediator: auth.mediator,
    mediatorJwt: auth.accessToken,
    client: { did: id.did, kid: id.kid, privateKey: id.xSecret, publicKey: id.xPublic },
    WebSocketImpl: WebSocket as any,
    onTspFrame: (bytes: Uint8Array) => (cb ? cb(bytes) : early.push(bytes)),
    onError: (e: any) => note(`[${id.name}] socket note: ${e?.message ?? e}`),
  } as any);
  await session.connect();
  return {
    kind: "mediator",
    send: (_to, bytes) => (session as any).sendBinary(bytes),
    onFrame: (f) => {
      cb = f;
      for (const b of early.splice(0)) f(b);
    },
    close: async () => {
      try {
        await (session as any).close?.();
      } catch {
        /* closing a throwaway socket */
      }
    },
  };
}

/** In-memory delivery. One hub per run; each party gets a Wire on it. */
export class Loopback {
  private inboxes = new Map<string, (bytes: Uint8Array) => void>();
  wire(id: Identity): Wire {
    return {
      kind: "loopback",
      send: (to, bytes) => {
        const deliver = this.inboxes.get(to);
        if (!deliver) throw new Error(`loopback: nobody is ${to}`);
        setTimeout(() => deliver(bytes), 0);
      },
      onFrame: (f) => void this.inboxes.set(id.did, f),
      close: async () => {},
    };
  }
}
