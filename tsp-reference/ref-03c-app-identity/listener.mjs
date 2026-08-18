// ref-03c capture server: the in-app probe POSTs its transcript here
// (RN ≥0.79 no longer forwards console.log to the Metro terminal).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      fs.writeFileSync(path.join(here, "out-app.txt"), body + "\n");
      console.log(`captured ${body.split("\n").length} lines from ${req.url}`);
      res.end("ok");
    });
  })
  .listen(8971, () => console.log("ref-03c listener on :8971 — launch the app now"));
