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
**Promote Android build** workflow (Actions tab → Run workflow → **Use workflow
from: staging**). It refuses any other branch, since the Play key belongs to the
`internal` environment, which only staging may use:

- Leave **dry run** ticked first: it prints both tracks, the plan and the
  notes, and commits nothing.
- Untick it to promote. The run first waits in the `open-testing` environment
  for a required reviewer (it holds no secrets), then promotes in `internal`.
- **rollout** below 1 makes a staged rollout (for example `0.2`).
- Release notes come from the release's `.github/play/whats-new.md` (500
  characters at most) when it has one, else its TestFlight notes cut to fit.

The service account needs permission to release to testing tracks in the Play
Console. If managed publishing is on, an approved release waits there until
someone publishes it.
