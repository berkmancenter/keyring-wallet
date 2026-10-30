/**
 * The OTA release this bundle was published as, e.g. "276.10". app/scripts/ota-deploy.mjs writes it in just before
 * it builds the bundle and puts the file back after (scripts/ota/release-stamp.mjs), so it is null in the repository:
 * in every store build, every dev bundle, and every update published before the release was stamped. A published
 * update therefore differs from its commit by this one line, and nothing else.
 */
export const OTA_RELEASE: string | null = null
