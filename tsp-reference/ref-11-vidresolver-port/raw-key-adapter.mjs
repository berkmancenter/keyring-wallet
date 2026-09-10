// The reference adapter: an in-memory VID→keys registry. No DID resolution,
// no network — a fixture-backed implementation of the VidResolver port
// (ports.mjs) so callers (and this rung's own round-trip proof) never care
// which adapter they're holding.

/**
 * @returns {import('./ports.mjs').VidResolver}
 */
export function createRawKeyVidResolver() {
  /** @type {Map<string, import('./ports.mjs').ResolvedVidKeys>} */
  const registry = new Map();
  return {
    register(vid, keys) {
      registry.set(vid, keys);
    },
    async resolve(vid) {
      const keys = registry.get(vid);
      if (!keys) {
        throw new Error(`ref-11: no fixture registered for vid ${vid}`);
      }
      return keys;
    },
  };
}
