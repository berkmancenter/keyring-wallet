// relay.mjs — the deliberately dumb pipe.
//
// An HTTP mailbox that stores and forwards opaque byte blobs. It contains
// ZERO TSP code — no imports from vti-tsp-js, no crypto, no envelope
// decoding. It cannot read payloads (sealed), and although it COULD decode
// the cleartext envelope labels (ref-01 proved anyone holding bytes can),
// it doesn't even bother. The pipe is dumb; the envelope is smart.
//
//   POST /send?to=<vid>   body = raw wire bytes  → queued for <vid>
//   GET  /recv?vid=<vid>  → oldest queued message (200) or empty (204)

import { createServer } from "node:http";

const mailboxes = new Map(); // vid → [Buffer, ...]
let moved = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST" && url.pathname === "/send") {
    const to = url.searchParams.get("to");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bytes = Buffer.concat(chunks);
      if (!mailboxes.has(to)) mailboxes.set(to, []);
      mailboxes.get(to).push(bytes);
      moved += bytes.length;
      console.log(`[relay] stored ${bytes.length}B for ${to} (total moved: ${moved}B) — contents: no idea, it's sealed`);
      res.writeHead(200).end();
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/recv") {
    const vid = url.searchParams.get("vid");
    const queue = mailboxes.get(vid);
    if (queue?.length) {
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(queue.shift());
    } else {
      res.writeHead(204).end();
    }
    return;
  }
  res.writeHead(404).end();
});

server.listen(0, "127.0.0.1", () => {
  console.log(`RELAY_READY ${server.address().port}`);
});
