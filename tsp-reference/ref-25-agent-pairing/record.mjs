// record.mjs: recording a VTA's answers so that two runs compare equal.
//
// A case's answers hold values that differ on every run: keys, context ids, device ids, times. `recorder` gives
// each such value a name and writes the name in its place. The same value always gets the same name and two
// different values never share one, so two recorded answers are equal exactly when the VTA's two answers were,
// and a reader can see which member differs.

const TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;
const DID_KEY = /did:key:z[1-9A-HJ-NP-Za-km-z]+/g;

/**
 * A recorder for one case. `known` names the values the case made itself, as `{ name: value }`; a name whose
 * value is `undefined` or empty is left out, so nothing else is ever written under it. Any other time becomes
 * `<time 1>`, `<time 2>`, in the order first seen, and any other `did:key` likewise.
 */
export function recorder(known) {
  const names = new Map();
  for (const [name, value] of Object.entries(known)) {
    if (typeof value !== "string" || value === "") continue;
    if (names.has(value)) throw new Error(`"${name}" and "${names.get(value)}" name the same value`);
    names.set(value, `<${name}>`);
  }
  // Longest first, so a value that is part of a longer one is never replaced inside it.
  const givenLongestFirst = [...names].sort(([a], [b]) => b.length - a.length);
  const counts = { time: 0, key: 0 };
  const nameOf = (kind, value) => {
    if (!names.has(value)) names.set(value, `<${kind} ${++counts[kind]}>`);
    return names.get(value);
  };
  return (value) => {
    if (value === undefined) return undefined;
    let text = JSON.stringify(value);
    for (const [raw, name] of givenLongestFirst) text = text.replaceAll(raw, name);
    text = text.replace(TIME, (time) => nameOf("time", time));
    text = text.replace(DID_KEY, (did) => nameOf("key", did));
    return JSON.parse(text);
  };
}
