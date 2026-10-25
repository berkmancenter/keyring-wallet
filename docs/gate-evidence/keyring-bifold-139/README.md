# keyring-bifold#139: sim gate evidence

iOS simulator (iPhone 17, iOS 26.3), Release, store config (nothing baked in).
Build: wallet `8fc74cd` + bifold `c8d28178`, `main.jsbundle` sha256 `a079c42e9130…`.
The phone was linked to the runner agent `keyring-runner-prague` (manual link) and
joined the lab community `keyring-test-vtc` (VTC 0.11.58), 2026-09-26 01:25–01:32Z.
The community's criteria were set to invitation-only for the joins and restored
after (digest verified).

Runner: `e2e/run-vti-invite.js`, `INVITE_VIA=console-push` then `console-qr`. The
runner issues the invitation and delivers it through the community's admin API,
the calls the admin console's **Send** and **QR offer** buttons make.

| # | What it shows |
|---|---|
| 1 | The phone's identity for the community, on "Send this to the community's admin" |
| 2 | Console **Send**: the invitation arrived on the phone by itself; nothing was opened |
| 3 | Join → member; the community's own member list agrees |
| 4 | An ordinary OpenID offer, scanned in the app, ends on the OpenID flow's full-screen error (the state a person was stuck in on 2026-09-25) |
| 5 | A `keyring://` link opened from outside comes to the top over it; the error is gone |
| 6 | The console's **QR offer**, scanned in the app: "Your invitation arrived" |
| 7 | Join → member; the community agrees |
| 8 | The same QR again: its code is spent, and the phone says so in words |
