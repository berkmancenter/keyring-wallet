/**
 * What the OTA leg (run-ota.mjs) accepts as evidence, kept apart so it can be tested on its own.
 * The server's check log (deploy/keyring-ota, OTA_LOG_CHECKS=1) has one line per request:
 *   <iso time> GET /files/bundles/<id>/manifest.json      an incremental download of bundle <id>
 *   <iso time> GET /files/bundles/<id>/bundle.zip         a full download of bundle <id>
 *   <iso time> GET /hot-updater/fingerprint/<platform>/…  an update check
 */

/** The server served bundle `id` (either download form); with no id, the server saw an update check. */
export function servedPattern(id) {
  if (!id) return /GET \/hot-updater\/fingerprint\//;
  if (!/^[0-9a-f-]+$/.test(id)) throw new Error(`not a bundle id: ${id}`);
  return new RegExp(`GET /files/bundles/${id}/(manifest\\.json|bundle\\.zip)`);
}

/**
 * The crash row's verdict. The path must have run: the bad bundle was served and the app lists it as rolled back,
 * and the app is on the good bundle and reached Home. Being on the good bundle alone proves nothing: a bundle that
 * was never downloaded leaves the app there too.
 */
export function crashRolledBack({ served, rolledBackLabel = "", running = "", good, bad, home }) {
  const rolledBack = Boolean(bad) && rolledBackLabel.split(/,\s*/).includes(bad);
  const onGood = Boolean(good) && running.includes(good) && !running.includes(bad);
  return { ok: Boolean(served) && rolledBack && onGood && Boolean(home), rolledBack, onGood };
}
