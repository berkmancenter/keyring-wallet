# Real-device e2e flakiness — patterns and fixes

Notes from getting `yarn e2e:vrc:devices:android-only:didcomm-v2` (two real
Android phones, hardware attestation, DIDComm v2) to a clean, repeatable
pass. None of this is specific to that one script — all three patterns live
in shared `e2e/lib/flows.js`/`lib/driver.js` helpers, so any real-device flow
can hit them. Recorded here in more depth than `e2e/README.md`'s
Troubleshooting section has room for, so the next person chasing a similar
failure can skip the multi-hour rediscovery.

## 1. A polling loop times out even though the exchange visibly succeeded

**Symptom**: `assertVrcReceived`, `acceptRelationshipProposalIfPrompted`,
`openContactDetail`, or `returnToContacts` throws a timeout — "no proposal
prompt", "contact did not appear", "could not land on Contacts" — but the
failure screenshot shows the device sitting on Chat.tsx's "Relationship
confirmed — X added to Contacts" overlay, an entirely successful state.

**Why**: each of these functions has a loop that watches for one specific
intermediate screen (a bottom sheet, the Contacts tab, `BackButton`) on the
way to some end state. On a real device, especially with hardware
attestation's extra biometric round trip, the whole propose → accept → sign
→ confirm ceremony can complete *faster* than the loop's own polling
interval, so it never catches the intermediate state — it only sees the
overlay that appears once everything is already done. Chat.tsx's overlay
also sets `pointerEvents="auto"`, so a loop that doesn't recognize it and
tries to tap "Contacts" or `BackButton` underneath taps nothing — the retry
doesn't help either.

**Fix**: every such loop needs to treat "the 'Relationship confirmed'
overlay is already showing" as a valid outcome, not a failure — check
`byTextContains(driver, "Relationship confirmed")` and either dismiss it
(`dismissVrcConfirmationOverlayIfPresent`) or, in
`acceptRelationshipProposalIfPrompted`'s case, just return `true` (the
overlay proves *a* proposal was accepted, whichever side did it). This
landed in four places — `assertVrcReceived` (both its navigation and
polling loops), `acceptRelationshipProposalIfPrompted`,
`openContactDetail`, `returnToContacts` — because each had grown its own
copy of the same "wait for an intermediate screen" pattern independently.
If you add a new function with a similar loop, add the same check.

## 2. A retry re-taps a toggle row and undoes its own progress

**Symptom**: `setAutoLockNever` (Settings → "Auto-Lock" → "Never", needed
before any developer-screen flow so the phone doesn't lock mid-run) fails
intermittently with "Never" not found, and the failure screenshot shows the
device scrolled to the *bottom* of the entire Settings list — "About this
App", "Export Wallet", nowhere near the Lockout row.

**Why**: the Lockout row's `onPress` (`Settings.tsx`) *toggles* its inline
dropdown: `setExpandedDropdown(expandedDropdown === 'autolock' ? null :
'autolock')`. The original retry logic re-tapped "Lockout" unconditionally
on a retry. If attempt 1's tap actually opened the dropdown but the search
loop was too slow to catch "Never" rendering, the retry's tap on the same
row *closed* it again — and the blind swipe-search that followed, now
searching for an option that no longer exists, just kept scrolling forward
through the whole (virtualized) list with no way to know it should stop,
landing at the very end.

**Fix, in two parts**:
- Don't re-tap the toggle row unconditionally — check whether its expanded
  content already exists in the tree (existence, not visibility; it may
  simply not be scrolled into view yet) before deciding to tap again.
- Give each dropdown option its own stable `testID`
  (`AutoLockTime<Id>` — bifold commit `d0692f0ba`) and scroll to it with
  Android's native `UiScrollable.scrollIntoView`, which understands the
  scrollable container directly, instead of a blind swipe-and-check loop
  guessing gesture distances against an unknown current scroll position.
  This is strictly more reliable *and* simpler than trying to bound the
  blind loop's scroll distance — that was tried first (bail out once the
  Lockout row itself scrolled off-screen) and didn't work, because
  WebDriver's `isDisplayed()` doesn't reliably report a virtualized row as
  off-screen once it's scrolled past; it can keep reporting `true`.

## 3. A tap reports success but `onPress` never fires

**Symptom**: even with fix #2 in place, one specific real device (older
hardware — this was a Galaxy S10) still failed to open the Lockout dropdown
at all, deterministically, across many attempts — not intermittent, not a
timing issue.

**How this was actually diagnosed** (worth reusing — this took far longer
to find than to fix, and a full end-to-end run is the wrong tool for
debugging one UI interaction):

1. Wrote a throwaway script (`node <script>` with `androidDeviceCaps`,
   `completeOnboarding`, then straight to `Settings`) that isolates just
   the Lockout interaction on the one problematic device — no peer device,
   no attestation, no DIDComm v2, no biometric prompts, no user
   interaction needed. Cut iteration time from ~10 minutes to under a
   minute.
2. That isolated script proved the option genuinely never appears, ever,
   even after a multi-second settle wait — ruling out a timing fix (a
   settle delay was tried in between and made no difference).
3. Added a temporary `console.log` directly inside the `onPress` handler
   itself (and a `useEffect` on the state it sets), re-ran the isolated
   script, and grepped `adb logcat -d` for the marker: **zero
   invocations** across multiple `.click()` attempts. The tap was never
   reaching the handler at all, despite WebDriver reporting the click
   command as successful and the accessibility node reporting
   `clickable="true"`, fully on-screen, correct bounds.
4. The accessibility dump showed this row's `class` as
   `android.widget.Button` (most other rows in this app show as
   `android.view.ViewGroup`). uiautomator2's `.click()` on a native
   `Button`-classed node can be dispatched as an Android **accessibility
   action** (`View.performClick()`) rather than a real touch event. React
   Native's gesture responder system, which `onPress` depends on for
   `TouchableOpacity`/`Pressable`, only listens for real touch input — an
   accessibility-triggered click bypasses it entirely, on this OS
   version/device combination.

**Fix**: `tapTestIdByCoordinates()` (`e2e/lib/driver.js`) — gets the
element's location and size, then performs a raw coordinate touch gesture
(pointer down, brief pause, up) at its center, instead of calling
WebDriver's `.click()`. A synthetic touch at real screen coordinates goes
through the actual Android input pipeline like a genuine finger tap,
regardless of how the accessibility layer would have routed a `.click()`.
`setAutoLockNever`'s Lockout tap now uses this on Android; `tapTestId`
elsewhere is untouched.

**When to reach for this vs. `tapTestIdReliable`**: `tapTestIdReliable`
(already in `driver.js`) retries a `.click()` with a `verify()` callback,
and is the right tool for a *probabilistic* dropped tap — some real devices
occasionally miss one. It will not help here: if `.click()` is
*consistently* not reaching `onPress` for a given element on a given
device, retrying the exact same ineffective mechanism just fails the same
way every time. The tell is the same as above — add a debug log in the
handler, confirm zero firings across several attempts (not "some attempts
lower than expected") — before reaching for `tapTestIdByCoordinates`
instead of `tapTestIdReliable`.
