/**
 * Type `text` into a field and prove the field holds exactly that. A single setValue of a long string can land with a
 * keystroke out of place on a headless iOS simulator (the Mac mini's hv vetter seat, 10-22: the agent's DID typed as
 * "di:webvh:…-vtad", the second "d" moved to the end, and the app rightly refused it). So: type, read the field back
 * (its `value` on iOS, its `text` on Android), and try again, the last try one character at a time, as the PIN is typed
 * on iOS. A field that never holds the text is the harness's failure, not the app's: the error says "driver:".
 * Dependency-free: the element only needs setValue, addValue, clearValue and getAttribute.
 */
export async function typeExact(el, text, { platform = "android", tries = 3, pauseMs = 120, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  // An element that cannot be read back (a page test's minimal fake) is typed once, as before: nothing to verify.
  if (typeof el.getAttribute !== "function") { await el.setValue(text); return { tries: 1, verified: false }; }
  const read = async () => String((await Promise.resolve(el.getAttribute(platform === "ios" ? "value" : "text")).catch(() => "")) ?? "");
  let got = "";
  for (let i = 1; i <= tries; i++) {
    if (typeof el.clearValue === "function") await Promise.resolve(el.clearValue()).catch(() => undefined);
    if (i < tries) await el.setValue(text);
    else for (const ch of text) { await el.addValue(ch); await wait(pauseMs); }
    got = await read();
    if (got === text) return { tries: i, verified: true };
  }
  throw Object.assign(new Error(`driver: the field holds "${got.slice(0, 120)}", not the ${text.length} characters typed, after ${tries} tries`), { observed: { typed: text, got } });
}
