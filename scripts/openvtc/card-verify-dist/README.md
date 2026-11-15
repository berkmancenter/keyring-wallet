# card-verify-dist: the VTI checkers, built once per pin

bifold's **VTI conformance** job runs upstream VTI's own SDK over the card and
statement Keyring produces (`card-verify`, and `card-verify-v047` for the 0.47
statement). Since the VTI pin moved to `vta-service-v0.79.0`, one dependency
(`trust-tasks-rs` 0.37.2) needs more than 14 GB of memory to compile, and cold
builds on GitHub's standard runners were killed every time (11-11). So the
checkers are built **once per pin** on an Apple-silicon Mac, published as a
release asset of this repository, and the job downloads them.

- `build.sh` builds both checkers at the pins in `../PINS.json`, checks they link
  only system libraries, and writes `DIST.json`. `--publish` also creates the
  release `card-verify-dist-<vti>-<v047>-<sources>`, where `<sources>` is a short
  hash of both checkers' source digests, so every distinct build gets its own
  release and never replaces binaries that `main` still downloads. It refuses to
  publish over an existing release. It needs a checkout whose `external/` clones
  are at the pins, and it is a heavy job: run it as the machine's only one (it
  watches cargo's own process and stops the build below 8 GiB free, since macOS
  swaps to the same disk).
- `digest.mjs` computes a checker's source digest: the VTI pin plus the hash of
  every file in the checker's directory except the inert ones it names
  (`README.md`, `check-keyring-card.sh`, `target/`). A new build input such as a
  `build.rs` or a `rust-toolchain.toml` is covered without changing it.
- `DIST.json` records, per checker, the VTI pin, the source digest, the sha256
  and the download URL.

Before judging anything, the conformance job checks that each `DIST.json` entry
was built at the pin `PINS.json` names today, recomputes the source digest from
this repository's `main`, and checks the download's sha256. Any mismatch fails
the job, so a pin bump or a checker change without a rebuild can never pass with
a stale checker. **After a VTI pin bump or a change to either checker, run
`build.sh --publish` and commit `DIST.json`.**

**What this does and does not prove.** The chain detects staleness: the
downloaded binary matches the sha256 committed in `DIST.json`, and the sources
and pin have not moved since that build. It does not prove the binary was
compiled from those sources; the trust root is whoever can publish the release
asset and commit `DIST.json`. That fits a test oracle, but it is not a
supply-chain attestation.

**After every rebuild, commit the new `DIST.json`.** Until it is on `main`, the
job fails on the sha256 or the digest, by design.
