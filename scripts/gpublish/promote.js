#!/usr/bin/env node

// Promotes the build already on one Google Play track to another, for
// example internal testing to open testing ("beta" in the API), without
// uploading it again. See the Google Play Developer API reference:
// https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks
//
// Env:
//   GOOGLE_API_CREDENTIALS  path to the service account JSON (required)
//   ANDROID_PACKAGE_NAME    e.g. asml.bkc.harvard.wallet (required)
//   FROM_TRACK              default "internal"
//   TO_TRACK                default "beta" (open testing)
//   VERSION_CODE            optional; must be a build on FROM_TRACK. Default:
//                           the highest version code on FROM_TRACK.
//   ROLLOUT                 fraction in (0, 1]; below 1 makes a staged rollout
//   NOTES_FILE              optional What to Test file; # lines are ignored
//   NOTES_LANGUAGE          default "en-CA"
//   DRY_RUN                 "true" (default) reads and reports, commits nothing

const { google } = require('googleapis');
const fs = require('fs');

const need = (name) => {
  if (!process.env[name]) {
    console.error(`${name} cannot be empty.`);
    process.exit(1);
  }
  return process.env[name];
};

// Play allows at most 500 characters of release notes per language.
const notesFrom = (file) => {
  if (!file || !fs.existsSync(file)) return null;
  const text = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  if (text.length <= 500) return text;
  // Cut at the last whole line that fits.
  const cut = text.slice(0, 497);
  const lastBreak = cut.lastIndexOf('\n');
  return (lastBreak > 200 ? cut.slice(0, lastBreak) : cut).trim() + '\n…';
};

const main = async () => {
  const keyFile = need('GOOGLE_API_CREDENTIALS');
  const packageName = need('ANDROID_PACKAGE_NAME');
  const fromTrack = process.env.FROM_TRACK || 'internal';
  const toTrack = process.env.TO_TRACK || 'beta';
  const dryRun = (process.env.DRY_RUN || 'true') !== 'false';
  const rollout = process.env.ROLLOUT ? Number(process.env.ROLLOUT) : 1;
  if (!(rollout > 0 && rollout <= 1)) {
    console.error(`ROLLOUT must be in (0, 1]; got ${process.env.ROLLOUT}.`);
    process.exit(1);
  }
  if (fromTrack === toTrack) {
    console.error('FROM_TRACK and TO_TRACK are the same.');
    process.exit(1);
  }

  const client = await google.auth.getClient({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const play = google.androidpublisher({ version: 'v3', auth: client, params: { packageName } });

  const edit = await play.edits.insert({ resource: {} });
  const editId = edit.data.id;

  const from = await play.edits.tracks.get({ editId, track: fromTrack });
  const onFrom = (from.data.releases || [])
    .filter((r) => r.status === 'completed' || r.status === 'inProgress')
    .flatMap((r) => r.versionCodes || []);
  if (onFrom.length === 0) {
    console.error(`No released build on ${fromTrack}.`);
    process.exit(1);
  }
  const wanted = process.env.VERSION_CODE || onFrom.map(Number).sort((a, b) => b - a)[0].toString();
  if (!onFrom.includes(wanted)) {
    console.error(`Build ${wanted} isn't on ${fromTrack} (it has ${onFrom.join(', ')}). Only a build already there can be promoted.`);
    process.exit(1);
  }

  const to = await play.edits.tracks.get({ editId, track: toTrack }).catch(() => ({ data: {} }));
  const onTo = (to.data.releases || []).map((r) => `${(r.versionCodes || []).join(',')} (${r.status})`);
  console.log(`${fromTrack}: ${onFrom.join(', ')}`);
  console.log(`${toTrack} now: ${onTo.join('; ') || 'nothing'}`);

  const notes = notesFrom(process.env.NOTES_FILE);
  const release = {
    name: `${wanted}`,
    versionCodes: [wanted],
    status: rollout < 1 ? 'inProgress' : 'completed',
    ...(rollout < 1 ? { userFraction: rollout } : {}),
    ...(notes ? { releaseNotes: [{ language: process.env.NOTES_LANGUAGE || 'en-CA', text: notes }] } : {}),
  };
  console.log(`Plan: put build ${wanted} on ${toTrack}, ${rollout < 1 ? `staged at ${rollout * 100}%` : 'to everyone on the track'}.`);
  console.log(notes ? `Notes (${notes.length} chars):\n${notes}` : 'Notes: none given; Play keeps the build\'s existing notes.');

  if (dryRun) {
    await play.edits.delete({ editId });
    console.log('Dry run: nothing committed.');
    return;
  }

  await play.edits.tracks.update({ editId, track: toTrack, resource: { track: toTrack, releases: [release] } });
  await play.edits.commit({ editId });
  console.log(`Committed: build ${wanted} is on ${toTrack}. Google reviews open-testing releases before testers see them.`);
};

main().catch((err) => {
  console.error(err.errors || err.message || err);
  process.exit(1);
});
