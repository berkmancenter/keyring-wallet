// Demo State Office: the officer screen for the local Guardian issuer (tools/sedi-state-office).
// Served by the issuer itself on 127.0.0.1, same origin. The officer token is pasted once and kept in
// sessionStorage only (never in a URL, never in localStorage). The signing keys never reach this page.
"use strict";
(() => {
  const TOKEN_KEY = "sedi-office-token";
  const $ = (id) => document.getElementById(id);

  // ---- token (this tab only) ------------------------------------------------------------------
  const readToken = () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return memoryToken;
    }
  };
  let memoryToken = "";
  const keepToken = (value) => {
    memoryToken = value;
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage blocked: the token lives in memory for this page only */
    }
  };

  // ---- the API --------------------------------------------------------------------------------
  class ApiError extends Error {
    constructor(status, code) {
      super(code || `HTTP ${status}`);
      this.status = status;
      this.code = code;
    }
  }
  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${readToken()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* no body */
    }
    if (!response.ok) throw new ApiError(response.status, data && data.error);
    return data;
  }

  // ---- words ----------------------------------------------------------------------------------
  const WHEN = { dateStyle: "medium", timeStyle: "short" };
  const when = (iso) => {
    const at = Date.parse(iso || "");
    return Number.isFinite(at) ? new Date(at).toLocaleString([], WHEN) : "—";
  };
  const short = (code) =>
    code && code.length > 14
      ? `${code.slice(0, 8)}…${code.slice(-4)}`
      : code || "";
  const SERVER_WORDS = {
    badHolder:
      "The guardian's code wasn't accepted. Ask them to show it again in Keyring.",
    badWard: "The ward's code wasn't accepted. Ask for it again in Keyring.",
    badValidity: "Choose a number of days between 1 and 3650.",
  };
  const failed = (error) => {
    if (error instanceof ApiError && error.status === 401)
      return "The token was not accepted. Paste it again.";
    if (error instanceof ApiError && error.code && SERVER_WORDS[error.code])
      return SERVER_WORDS[error.code];
    if (error instanceof ApiError)
      return `The issuer refused (${error.code || error.status}).`;
    return "Couldn't reach the issuer on this computer. Is it running?";
  };
  const say = (el, text, kind) => {
    el.textContent = text || "";
    el.className = `said${kind ? ` ${kind}` : ""}`;
  };

  // ---- codes, checked here only to say what is wrong early; the issuer checks for real ------
  const B64URL = /^[A-Za-z0-9_-]+$/;
  const holderProblem = (code) => {
    if (!code) return "Paste the guardian's code.";
    if (!B64URL.test(code) || code.length !== 44 || !/^[EI]/.test(code))
      return "That doesn't look like a guardian's code: it is 44 characters and starts with E or I.";
    return "";
  };
  const wardProblem = (code, holder) => {
    if (!code) return "Paste the ward's code.";
    const shape =
      (code.length === 44 && code.startsWith("B")) ||
      (code.length === 48 && code.startsWith("1AAI"));
    if (!B64URL.test(code) || !shape)
      return "That doesn't look like a ward's code: 44 characters starting with B, or 48 starting with 1AAI.";
    if (code === holder)
      return "The ward's code is the same as the guardian's. They need to be two different people.";
    return "";
  };
  const daysProblem = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 3650
      ? ""
      : "Choose a whole number of days between 1 and 3650.";
  };
  const mark = (input, errEl, problem) => {
    errEl.textContent = problem;
    input.setAttribute("aria-invalid", problem ? "true" : "false");
    return !problem;
  };

  // ---- health ---------------------------------------------------------------------------------
  async function connect() {
    const health = $("health");
    try {
      const h = await api("GET", "/api/health");
      // A card can only be issued while the keystore is unlocked; say so rather than fail on Issue.
      const locked = h && h.keystore === "locked";
      health.textContent = locked
        ? "Connected · keystore locked: unlock it in the issuer first"
        : `Connected · publishing to ${h && h.host ? h.host : "the demo host"}${
            h && h.hosts && h.hosts.test
              ? ` and ${h.hosts.test.host} (TEST)`
              : ""
          }`;
      health.className = `health ${locked ? "bad" : "ok"}`;
      $("issue-btn").disabled = locked;
      for (const id of ["issue-panel", "list-panel", "files-panel"])
        $(id).hidden = false;
      say($("token-said"), "Connected.", "ok");
      roles = (h && h.aids) || {};
      hosts = (h && h.hosts) || {};
      // Two hosts only when the office runs with --test-host; otherwise nothing here changes.
      const two = Boolean(hosts.test);
      $("host-field").hidden = !two;
      $("tree-switch").hidden = !two;
      $("host-prod").textContent = (hosts.prod && hosts.prod.host) || "";
      $("host-test").textContent = two ? hosts.test.host : "";
      if (!two) setTree("prod");
      await loadList();
      await loadFiles();
      return true;
    } catch (error) {
      health.textContent = "Not connected";
      health.className = "health bad";
      for (const id of ["issue-panel", "list-panel", "result", "files-panel"])
        $(id).hidden = true;
      say($("token-said"), failed(error), "bad");
      return false;
    }
  }

  $("token-form").addEventListener("submit", (event) => {
    event.preventDefault();
    keepToken($("token").value.trim());
    $("token").value = "";
    void connect();
  });

  // ---- issue ----------------------------------------------------------------------------------
  // The QR comes from the issuer as SVG text; shown through <img> as a data: URL, so nothing in it can run.
  const withNamespace = (svg) =>
    /^<svg\b(?![^>]*\bxmlns=)/.test(svg || "")
      ? svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
      : svg || "";
  const svgAsImage = (svg) =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNamespace(svg))}`;

  function showResult(card) {
    $("result").hidden = false;
    $("result-qr").src = svgAsImage(card.qrSvg);
    $("result-qr").hidden = !card.qrSvg;
    // published:false with no publishError means there is no upload step (served from this computer), not a failure.
    $("result-state").textContent = card.publishError
      ? "Issued, but the pick-up page was not uploaded."
      : card.published
        ? "Published. The guardian's phone checks it when they scan."
        : "Issued. The pick-up page is ready on this computer; the guardian's phone checks it when they scan.";
    $("result-publish").textContent = card.publishError
      ? `The upload failed (${card.publishError}). The QR here still works.`
      : "";
    $("result-pickup").textContent = card.pickupUrl || "—";
    $("result-offer").textContent = card.offerUrl || "—";
    $("result-issued").textContent = when(card.issuedAt);
    $("result-expires").textContent = when(card.expiresAt);
    $("result-id").textContent = card.id || "—";
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("issue-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const holder = $("holder").value.trim();
    const ward = $("ward").value.trim();
    const label = $("label").value.trim();
    const validDays = $("validDays").value.trim();
    const ok = [
      mark($("holder"), $("holder-err"), holderProblem(holder)),
      mark($("ward"), $("ward-err"), wardProblem(ward, holder)),
      mark($("validDays"), $("validDays-err"), daysProblem(validDays)),
    ].every(Boolean);
    if (!ok) return;
    const button = $("issue-btn");
    button.disabled = true;
    say($("issue-said"), "Issuing…");
    try {
      const card = await api("POST", "/api/cards", {
        holder,
        ward,
        ...(label ? { label } : {}),
        validDays: Number(validDays),
        ...(hosts.test ? { host: chosenHost() } : {}),
      });
      say($("issue-said"), "");
      $("issue-form").reset();
      showResult(card);
      await loadList();
      await loadFiles();
    } catch (error) {
      say($("issue-said"), failed(error), "bad");
    } finally {
      button.disabled = false;
    }
  });

  // ---- list and revoke ------------------------------------------------------------------------
  function row(card) {
    const li = $("card-row").content.firstElementChild.cloneNode(true);
    li.querySelector(".card-label").textContent = card.label || "No note";
    li.querySelector(".card-codes").textContent =
      `Guardian ${short(card.holder)} · Ward ${short(card.ward)}`;
    const revoked = card.status === "revoked";
    li.querySelector(".card-dates").textContent = revoked
      ? `Issued ${when(card.issuedAt)} · Revoked ${when(card.revokedAt)}`
      : `Issued ${when(card.issuedAt)} · Valid until ${when(card.expiresAt)}`;
    const pill = li.querySelector(".pill");
    // The list carries no publishError: an issued card is "Issued" whether it was uploaded or is served from here.
    pill.textContent = revoked ? "Revoked" : "Issued";
    pill.className = `pill ${revoked ? "revoked" : "issued"}`;
    // Which host the card names, for life. An orphan's host is no longer designated: re-issue to move it.
    const host = li.querySelector(".pill.host");
    const kind = card.hostDesignated === false ? "orphan" : card.hostKind;
    host.hidden = !card.host || (!hosts.test && kind !== "orphan");
    host.textContent =
      kind === "orphan"
        ? `${card.host}: host not designated; re-issue to move`
        : `${kind === "test" ? "TEST" : "PROD"} · ${card.host || ""}`;
    host.className = `pill host ${kind === "orphan" ? "orphan" : ""}`.trim();

    const revoke = li.querySelector(".revoke");
    const confirm = li.querySelector(".confirm");
    revoke.hidden = revoked;
    revoke.addEventListener("click", () => {
      revoke.hidden = true;
      confirm.hidden = false;
      confirm.querySelector(".no").focus();
    });
    confirm.querySelector(".no").addEventListener("click", () => {
      confirm.hidden = true;
      revoke.hidden = false;
    });
    confirm.querySelector(".yes").addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        const done = await api(
          "POST",
          `/api/cards/${encodeURIComponent(card.id)}/revoke`,
        );
        say(
          $("list-said"),
          done && done.publishError
            ? `Revoked here, but the pick-up page upload failed (${done.publishError}).`
            : "Revoked. The pick-up page now says so.",
          done && done.publishError ? "bad" : "ok",
        );
      } catch (error) {
        say($("list-said"), failed(error), "bad");
      }
      await loadList();
      await loadFiles();
    });
    return li;
  }

  async function loadList() {
    try {
      const cards = (await api("GET", "/api/cards")) || [];
      cards.sort(
        (a, b) => Date.parse(b.issuedAt || "") - Date.parse(a.issuedAt || ""),
      );
      $("cards").replaceChildren(...cards.map(row));
      $("empty").hidden = cards.length > 0;
    } catch (error) {
      say($("list-said"), failed(error), "bad");
    }
  }
  $("refresh").addEventListener("click", () => {
    say($("list-said"), "");
    void loadList();
  });

  // ---- published files: read only, testing only ----------------------------------------------
  // What the public server hands to phones, read from the publish folder through the officer API (which serves
  // that folder only). Everything is shown as text: textContent, never markup.
  let roles = {};
  let hosts = {};
  let tree = "prod";
  const chosenHost = () =>
    (document.querySelector('input[name="host"]:checked') || {}).value ||
    "prod";
  const setTree = (which) => {
    tree = which;
    for (const b of document.querySelectorAll("#tree-switch [data-tree]"))
      b.setAttribute("aria-pressed", String(b.dataset.tree === which));
  };
  const ROLE_WORDS = {
    roy: "State root",
    deb: "Org unit",
    sue: "Issuing agent",
  };
  const DID_PATH = "keyring-demo-state/";
  const groupOf = (path) => {
    if (path.startsWith(DID_PATH)) {
      const aid = path.slice(DID_PATH.length).split("/")[0];
      const role = Object.keys(roles).find((r) => roles[r] === aid);
      return {
        key: `did:${aid}`,
        title: role ? ROLE_WORDS[role] || role : "K0 kit (fixture)",
        who: short(aid),
        order: role ? Object.keys(ROLE_WORDS).indexOf(role) : 10,
      };
    }
    const card = /^cards\/([^/.]+)\./.exec(path);
    if (card)
      return {
        key: `card:${card[1]}`,
        title: "Card pick-up",
        who: short(card[1]),
        order: 20,
      };
    return { key: "other", title: "Other", who: "", order: 30 };
  };
  const size = (n) =>
    n < 1024 ? `${n} bytes` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;

  async function apiText(path) {
    const response = await fetch(path, {
      headers: { Authorization: `Bearer ${readToken()}` },
      cache: "no-store",
    });
    if (!response.ok) {
      let code = null;
      try {
        code = (await response.json()).error;
      } catch {
        /* no body */
      }
      throw new ApiError(response.status, code);
    }
    return response.text();
  }

  // The end of the JSON object that starts at `start`, or -1: braces counted outside strings only.
  const objectEnd = (text, start) => {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i += 1) {
      const c = text[i];
      if (inString) {
        if (c === "\\") i += 1;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth += 1;
      else if (c === "}" && --depth === 0) return i + 1;
    }
    return -1;
  };
  // Key events carry their sequence number in "s" (an ACDC uses "s" for its schema).
  const KEL_TYPES = new Set(["icp", "rot", "ixn", "dip", "drt"]);
  // A KEL as CESR text: each event's JSON pretty-printed, its signatures (the attachment) on the lines after it.
  const readableKel = (text) => {
    const out = [];
    let at = text.indexOf("{");
    if (at !== 0) return null;
    let n = 0;
    while (at !== -1 && at < text.length) {
      const end = objectEnd(text, at);
      if (end === -1) return null;
      let event;
      try {
        event = JSON.parse(text.slice(at, end));
      } catch {
        return null;
      }
      const next = text.indexOf('{"v":', end);
      const attachment = text.slice(end, next === -1 ? text.length : next);
      n += 1;
      out.push(
        `# event ${n}${event.t ? ` · ${event.t}` : ""}${
          KEL_TYPES.has(event.t) ? ` · sn ${event.s}` : ""
        }`,
        JSON.stringify(event, null, 2),
        ...(attachment.trim() ? ["# attachment", attachment.trim()] : []),
        "",
      );
      at = next;
    }
    return out.join("\n");
  };
  const readable = (path, text) => {
    if (path.endsWith(".json")) {
      try {
        return { text: JSON.stringify(JSON.parse(text), null, 2), note: "" };
      } catch {
        return { text, note: "Not valid JSON; shown as it is." };
      }
    }
    if (path.endsWith(".cesr")) {
      const kel = readableKel(text);
      return kel
        ? { text: kel, note: "The key event log, one event at a time." }
        : { text, note: "Shown as it is." };
    }
    if (path.endsWith(".html"))
      return {
        text,
        note: "Shown as source. This is the page a phone's browser opens.",
      };
    return { text, note: "" };
  };

  async function view(file) {
    const viewer = $("viewer");
    $("viewer-path").textContent = file.path;
    $("viewer-note").textContent = "Opening…";
    $("viewer-text").textContent = "";
    viewer.hidden = false;
    try {
      const shown = readable(
        file.path,
        await apiText(
          `/api/files/view?tree=${tree}&path=${encodeURIComponent(file.path)}`,
        ),
      );
      $("viewer-note").textContent = shown.note;
      $("viewer-text").textContent = shown.text;
    } catch (error) {
      $("viewer-note").textContent =
        error instanceof ApiError && error.status === 404
          ? "That file is no longer published."
          : failed(error);
    }
    viewer.scrollIntoView({ behavior: "smooth", block: "start" });
    $("viewer-text").focus({ preventScroll: true });
  }
  $("viewer-close").addEventListener("click", () => {
    $("viewer").hidden = true;
  });

  // Every entry in the folder is listed, since the public server hands them all out; one the viewer won't open
  // says why instead of going missing (a missing file would read as not published).
  const WHY_NOT = {
    notPlainPath: "its name isn't a plain path",
    symlinked: "it is a link",
    notRegularFile: "it isn't a regular file",
    hardLinked: "it is hard-linked to another file",
    notViewableType: "only .json, .cesr and .html files open here",
    tooLarge: "it is larger than 2 MB",
  };
  function fileRow(file, index, fullPath) {
    const li = $("file-row").content.firstElementChild.cloneNode(true);
    li.querySelector(".file-name code").textContent = fullPath
      ? file.path
      : file.path.split("/").pop();
    li.querySelector(".file-meta").textContent = `${size(
      file.size,
    )} · written ${when(file.modified)}`;
    const why = li.querySelector(".file-why");
    why.hidden = file.viewable;
    why.textContent = file.viewable
      ? ""
      : `Published, but not opened here: ${WHY_NOT[file.reason] || "it can't be read safely"}.`;
    const url = li.querySelector(".file-url code");
    url.textContent = file.publicUrl;
    url.id = `file-url-${index}`;
    li.querySelector(".copy-url").dataset.copy = url.id;
    const open = li.querySelector(".view");
    open.hidden = !file.viewable;
    open.addEventListener("click", () => void view(file));
    return li;
  }

  async function loadFiles() {
    try {
      const got = (await api("GET", `/api/files?tree=${tree}`)) || {};
      const files = got.files || [];
      $("files-site").textContent = got.siteUrl || "—";
      const groups = new Map();
      files.forEach((file, index) => {
        const g = groupOf(file.path);
        if (!groups.has(g.key)) groups.set(g.key, { ...g, rows: [] });
        groups.get(g.key).rows.push(fileRow(file, index, g.key === "other"));
      });
      const sections = [...groups.values()]
        .sort((a, b) => a.order - b.order)
        .map((g) => {
          const box = document.createElement("div");
          box.className = "file-group";
          const h = document.createElement("h3");
          h.textContent = g.title;
          if (g.who) {
            const who = document.createElement("span");
            who.className = "who";
            who.textContent = ` · ${g.who}`;
            h.append(who);
          }
          const ul = document.createElement("ul");
          ul.className = "files";
          ul.append(...g.rows);
          box.append(h, ul);
          return box;
        });
      $("files-groups").replaceChildren(...sections);
      $("files-empty").hidden = files.length > 0;
      say(
        $("files-said"),
        got.truncated
          ? `Showing the first ${files.length} entries; the folder holds more.`
          : "",
        got.truncated ? "bad" : "",
      );
    } catch (error) {
      say($("files-said"), failed(error), "bad");
    }
  }
  $("files-refresh").addEventListener("click", () => void loadFiles());
  for (const b of document.querySelectorAll("#tree-switch [data-tree]"))
    b.addEventListener("click", () => {
      setTree(b.dataset.tree);
      $("viewer").hidden = true;
      void loadFiles();
    });

  // ---- copy -----------------------------------------------------------------------------------
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const label = (button.dataset.label ||= button.textContent.trim());
    const text = $(button.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      const range = document.createRange();
      range.selectNodeContents($(button.dataset.copy));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = "Selected";
    }
    setTimeout(() => (button.textContent = label), 1500);
  });

  if (readToken()) void connect();
})();
