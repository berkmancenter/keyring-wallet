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
        : `Connected · publishing to ${h && h.host ? h.host : "the demo host"}`;
      health.className = `health ${locked ? "bad" : "ok"}`;
      $("issue-btn").disabled = locked;
      for (const id of ["issue-panel", "list-panel"]) $(id).hidden = false;
      say($("token-said"), "Connected.", "ok");
      await loadList();
      return true;
    } catch (error) {
      health.textContent = "Not connected";
      health.className = "health bad";
      for (const id of ["issue-panel", "list-panel", "result"])
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
  const svgAsImage = (svg) =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg || "")}`;

  function showResult(card) {
    $("result").hidden = false;
    $("result-qr").src = svgAsImage(card.qrSvg);
    $("result-qr").hidden = !card.qrSvg;
    $("result-state").textContent = card.published
      ? "Published. The guardian's phone checks it when they scan."
      : "Issued, but not published yet.";
    $("result-publish").textContent = card.published
      ? ""
      : `The pick-up page could not be published${card.publishError ? ` (${card.publishError})` : ""}. The QR here still works.`;
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
      });
      say($("issue-said"), "");
      $("issue-form").reset();
      showResult(card);
      await loadList();
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
    pill.textContent = revoked
      ? "Revoked"
      : card.published
        ? "Issued"
        : "Not published";
    pill.className = `pill ${revoked ? "revoked" : card.published ? "issued" : "unpublished"}`;

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
          done && done.published
            ? "Revoked and published. The pick-up page now says so."
            : `Revoked here, but the pick-up page was not updated${done && done.publishError ? ` (${done.publishError})` : ""}.`,
          done && done.published ? "ok" : "bad",
        );
      } catch (error) {
        say($("list-said"), failed(error), "bad");
      }
      await loadList();
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

  // ---- copy -----------------------------------------------------------------------------------
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
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
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });

  if (readToken()) void connect();
})();
