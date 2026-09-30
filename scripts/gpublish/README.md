This is a script to help publish to the Google Play API so that
we have an automated end-to-end CICD pipeline.

When you make changes, make sure it publish it to npm with
`npm publish`.

Usage:

`npx @bcgov/gpublish`

## Promoting a build to open testing

`promote.js` moves the build already on a track (internal testing by default)
to another (open testing, `beta` in the API) without uploading it again. It
refuses a build that isn't on the source track. Run it through the
**Promote Android build** workflow (Actions tab → Run workflow):

- Leave **dry run** ticked first: it prints both tracks, the plan and the
  notes, and commits nothing.
- Untick it to promote. That run uses the `open-testing` environment; give that
  environment a required reviewer in the repository settings, so a promotion
  waits for approval.
- **rollout** below 1 makes a staged rollout (for example `0.2`).
- Release notes come from staging's `.github/play/whats-new.md` (500 characters
  at most) when a release has one, else its TestFlight notes cut to fit.

The service account needs permission to release to testing tracks in the Play
Console. If managed publishing is on, an approved release waits there until
someone publishes it.
