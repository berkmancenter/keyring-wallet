// Demo State Office: "Scan from phone". The Mac's camera reads the QR a phone shows on its codes screen (the raw
// code), and each new code goes into the paste box, whose own parser (codes.js) fills the guardian's or the ward's
// field. Scan the guardian's phone, then the ward's. Nothing leaves this computer: the camera is read here, on
// 127.0.0.1 (a secure context), and the stream is stopped when both fields are filled, on Stop, or on any error.
// Decoding is the browser's own BarcodeDetector (Chrome and Edge on macOS); a browser without it says so and the
// paste box still works. No decoder is loaded from anywhere.
"use strict";
(() => {
  /** The paste box's text with `raw` added on its own line, or null when it is already there or is empty. */
  const appendScanned = (text, raw) => {
    const code = String(raw ?? "").trim();
    if (!code) return null;
    const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim());
    if (lines.includes(code)) return null;
    return [String(text ?? "").replace(/\s+$/, ""), code].filter(Boolean).join("\n");
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { appendScanned };
    return;
  }

  const $ = (id) => document.getElementById(id);
  const say = (text, kind) => {
    const el = $("scan-said");
    el.textContent = text || "";
    el.className = `said${kind ? ` ${kind}` : ""}`;
  };
  let stream = null;
  let timer = null;

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    const video = $("scan-video");
    video.srcObject = null;
    video.hidden = true;
    $("scan").textContent = "Scan from phone";
  };

  const both = () => $("holder").value.trim() && $("ward").value.trim();

  const start = async () => {
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
      say("This browser can't read QR codes. Open this page in Chrome, or paste the codes.", "bad");
      return;
    }
    let detector;
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (!formats.includes("qr_code")) throw new Error("no qr_code");
      detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    } catch {
      say("This browser can't read QR codes. Open this page in Chrome, or paste the codes.", "bad");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch {
      say("The camera wasn't allowed, or there isn't one. Paste the codes instead.", "bad");
      return;
    }
    const video = $("scan-video");
    video.srcObject = stream;
    video.hidden = false;
    await video.play().catch(() => undefined);
    $("scan").textContent = "Stop";
    say("Hold a phone's code up to the camera.", "");
    timer = setInterval(async () => {
      if (!stream || video.readyState < 2) return;
      let found = [];
      try {
        found = await detector.detect(video);
      } catch {
        return;
      }
      for (const f of found) {
        const next = appendScanned($("paste").value, f.rawValue);
        if (next === null) continue;
        $("paste").value = next;
        $("paste").dispatchEvent(new Event("input"));
        say("Read one. Now the other phone.", "ok");
      }
      if (both()) {
        stop();
        say("Both codes read. Check them, then issue.", "ok");
      }
    }, 300);
  };

  document.addEventListener("DOMContentLoaded", () => {
    $("scan").addEventListener("click", () => (stream ? (stop(), say("")) : void start()));
    window.addEventListener("pagehide", stop);
    $("issue-form").addEventListener("reset", () => {
      stop();
      say("");
    });
  });
})();
