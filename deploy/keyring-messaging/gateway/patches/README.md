# Patches applied to vti-push-gateway

The Dockerfile applies these, in order, on top of the pinned commit
(`GATEWAY_COMMIT`), and the `push-gateway-image` workflow runs the gateway's
own test suite with them applied. Each is a clean `git format-patch` against
that commit, kept apart from anything Keyring-specific.

| Patch | What | Upstream |
| --- | --- | --- |
| `0001-sender-optional-visible-alert-mode-for-interactive-wakes.patch` | Optional visible alert mode: an interactive wake is sent as a notification the platform shows from the app's own string for a key (APNs `alert` + `loc-key`, FCM notification + `body_loc_key`), instead of a silent push that iOS throttles and drops after a force-quit. Off unless `GATEWAY_ALERT_LOC_KEY` is set. Tests and a README section included | Candidate to contribute; not submitted. The project lead offers it upstream; no pull request or issue is opened from here |
| `0002-controllers-optional-DID-host-allowlist-for-closed-deployments.patch` | Optional DID-host allowlist: `GATEWAY_ALLOWED_CONTROLLER_HOSTS` also serves every `did:webvh` / `did:web` controller on a listed host (exact, or `*.` + at least two labels for subdomains only), next to the exact `GATEWAY_ALLOWED_CONTROLLERS` list. For deployments whose DID hosts are closed, so a new VTA needs no redeploy. Not combinable with `*`. Unset = unchanged behaviour. Tests and a README note included | Same as 0001 |

When `GATEWAY_COMMIT` moves, re-apply each patch onto the new commit
(`git am`), fix conflicts there, and regenerate the file with
`git format-patch -1`.
