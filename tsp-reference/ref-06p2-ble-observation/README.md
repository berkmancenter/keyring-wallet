# ref-06p2 — the locality binding over real BLE

[`ref-06p`](../ref-06p-locality-binding/) proved the EID/transcript algebra
with no radios: the rendezvous EID *locates*, the signed GATT transcript
*binds*, and four forgeries are each rejected by a named check. What it could
not prove — because it deliberately used none — is whether the same
service-UUID scheme discriminates a real advert out of real ambient BLE
noise, and what a real GATT round trip costs in time. That is this rung.

Design under test: [`docs/plans/locality-plan.md`](../../docs/plans/locality-plan.md)
§5.3 (the EID/transcript split), §5.5 (the timing bound, and what it does and
does not exclude).

**Needs: two BLE radios.** This box (`hci0`) plays the **sensor** — scanning
and GATT-central, via BlueZ's D-Bus API (`node-ble`) — which is also its
*production* role (plan §5.6: the witness server is its own sensor). The
**device** role is played by a phone running a GATT-server test app (nRF
Connect for Mobile), not a second process on this box — a phone with its own
radio, that this code does not control the internals of, is a closer analog
to production than a loopback on one adapter, and it is also what was on
hand.

**Why D-Bus and not a raw HCI socket.** An earlier version of this rung used
`@abandonware/noble` directly against `hci0`. On this box that produced zero
discover events — not a permissions problem (confirmed as root), and not a
dead radio (`bluetoothctl scan on` saw the room fine at the same time) —
because two independent processes opening the same raw HCI channel and racing
`bluetoothd` for LE scan state is exactly the silent-failure mode noble's own
README warns about ("you will not get any errors... but nothing will
happen"). Going through BlueZ's D-Bus interface — the same path
`bluetoothctl` uses — sidesteps the contention instead of requiring
`bluetoothd` to be stopped, which also matters for production: a witness
box's Bluetooth stack shouldn't need to be disabled for anything else it
does.

**Platform: Linux only.** `node-ble` talks to BlueZ over D-Bus, and BlueZ is
Linux-specific — there is no D-Bus/BlueZ on macOS or Windows, so this rung
cannot run on either. This is not a gap to work around: plan §5.6 already
settled that the production witness server runs on Linux at the venue, so a
Linux-only sensor implementation is the target, not a limitation of this
rung specifically. It does mean a Keyring engineer on a Mac or Windows
laptop needs a Linux box or VM (with BLE adapter passthrough, which most
consumer VM setups do not give you cleanly) to run this one locally — CI or
a spare Linux machine, not a laptop dev loop. (For contrast: the raw-socket
library this rung moved away from, `@abandonware/noble`, does run on macOS
via CoreBluetooth — but not Windows either, and it's the wrong choice here
regardless of OS; see "Why D-Bus and not a raw HCI socket" below.)

**Run:**

```sh
npm install
npm run setup -- --target A     # prints the exact phone-side GATT config
npm start                        # scans, connects, measures the round trip
npm run check                    # same, quiet
```

One-time setup this needs beyond `npm install` — a D-Bus policy allowing this
user to own/talk to `org.bluez` (`node-ble`'s own quick-start step):

```sh
echo '<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
  "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <policy user="'"$(id -un)"'">
   <allow own="org.bluez"/>
    <allow send_destination="org.bluez"/>
    <allow send_interface="org.bluez.GattCharacteristic1"/>
    <allow send_interface="org.bluez.GattDescriptor1"/>
    <allow send_interface="org.freedesktop.DBus.ObjectManager"/>
    <allow send_interface="org.freedesktop.DBus.Properties"/>
  </policy>
</busconfig>' | sudo tee /etc/dbus-1/system.d/node-ble.conf > /dev/null
sudo systemctl reload dbus
```

(one-time per machine).

**If the adapter looks dead** (BlueZ reports `Discovering: yes` but
`bluetoothctl devices` / this rung sees nothing, even ambient traffic): that
was a real, reproducible failure mode on the dev machine this rung was first
run on, unrelated to permissions or code — root-level scanning saw the same
nothing. A `btusb` driver reload cleared it every time it recurred:

```sh
sudo systemctl stop bluetooth
sudo modprobe -r btusb && sleep 1 && sudo modprobe btusb
sudo systemctl start bluetooth
```

## What it proves

- **The discrimination works against real ambient BLE, not a hand-picked
  input.** The sensor watches for three candidate session EIDs
  simultaneously (the plan's ≥1 open-session case generalized) and connects
  only to the peripheral whose advertised service UUID matches one of them.
  Measured runs saw 8–11 other real BLE devices per scan (solar/battery
  equipment, a smart light, phones) and correctly ignored all of them — real
  noise, not a mocked absence of noise.
- **The GATT round trip completes over the air**, end to end: connect,
  discover the service and characteristic, write a fresh nonce, read it back,
  disconnect — against a phone's real Bluetooth radio, not a simulated one.
- **The honest RTT distribution is measured, not asserted.** Each run appends
  `{n, medianMs, p95Ms, worstMs, bestMs}` to `fixtures/measured-rtt.jsonl`,
  dated and tagged with the peripheral it ran against. Two runs against a
  Galaxy S20+ (35 trials total) landed consistently at **median ≈180ms,
  p95 ≈224ms** — connect + discover-services + N×(write-with-response +
  read), one Linux laptop's BlueZ stack to one Android phone's GATT server,
  same order of magnitude as the plan's own description of real BLE
  connection intervals (§5.5: "iOS enforces a 15ms floor and commonly
  negotiates 30ms"). This is the input [`ref-06p4`](../ref-06p4-relay-trial/)
  needs to set the timing bound from measurement rather than assertion — two
  runs on one pairing is a start, not the final input; re-run on the
  adapter/phone pairing production will actually use before trusting a bound
  derived from it.

## What it does NOT prove

- **Only one of the three candidate sessions is actually advertised.** The
  phone broadcasts session `A` (or whichever `--target` you configure); `B`
  and `C` exercise the matching logic against real ambient noise, not against
  two other genuinely open sessions with their own live peripherals. Proving
  discrimination among *multiple simultaneous real advertisers* needs either
  a second phone or a second adapter and is not attempted here.
- **No signature, no hardware-attestation key.** nRF Connect's GATT server
  echoes whatever bytes are written; it cannot sign anything with a
  Secure-Enclave-backed key. The round trip here is a bare nonce-echo for
  timing purposes only — the signed-transcript binding itself (the part that
  actually proves "this credential's key was in range") is ref-06p's job,
  proven with no radios, and stays that way until the Keyring app's own
  peripheral role ships (locality-plan §10.3 item 9) and can be pointed at
  this same sensor script.
- **No relay, no attacker.** That is [`ref-06p4`](../ref-06p4-relay-trial/):
  a staged relay with injected latency, using the RTT distribution this rung
  measures as its baseline.
- **No RSSI, on this stack.** BlueZ's D-Bus `RSSI` property is populated
  during active discovery and reliably empties out once a device stops being
  freshly re-advertised-into or a connection is active — `device.getRSSI()`
  returned `null` in both measured runs even when captured just before
  connecting. The script still tries and records it (`advertisedRssiDbm`)
  since some BlueZ versions/timings do populate it, but don't expect it —
  the RTT figures did not need it, and §5.5's bound is timing-based, not
  RSSI-based.
- **Not a frozen fixture in the usual ladder sense.** Real radios do not
  reproduce a byte-identical RTT run to run, so `measured-rtt.jsonl` is an
  appended, dated log of real measurements, not a fixture the script checks
  itself against. The `check()` assertions that do run are about
  *correctness* (discriminated the right session, every echo matched) —
  timing is reported, never pass/failed against a threshold, because no
  threshold has been set yet (that is what this data is for).
- **One adapter, one phone, one room.** `ref-06p2`'s "Needs" column in the
  ladder said "two BLE radios"; it did not say a representative venue
  deployment. Treat the numbers here as a first real measurement, not the
  final input to the bound — re-run before that decision is made.

## Fixtures

- `fixtures/measured-rtt.jsonl` — one JSON object per run, appended. Not
  checked into a fixed expected value; read for the distribution it shows,
  and to see whether p95 stays roughly stable across the runs it accumulates.
