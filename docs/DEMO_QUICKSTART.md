# Running a Keyring demo from scratch

For someone who has never built a mobile app before. It assumes you can use a
terminal and nothing else — every tool you need is listed, with what it is for.

By the end you will have Keyring running on an Android emulator on your own
machine, talking to a mediator you are also running, with no accounts, no
servers, and no configuration files to edit.

Budget **about an hour**, most of it downloads and the first build.

## The short version

If you would rather not install things by hand, one command checks your
toolchain, installs whatever is missing, and starts the demo:

```sh
git clone --recurse-submodules https://github.com/berkmancenter/keyring-wallet.git
cd keyring-wallet
yarn quickstart
```

It asks before installing anything, and `yarn doctor` reports what you are
missing without changing a thing.

It handles Node, the JDK, the Android SDK, an emulator and the project's
dependencies, on **macOS and Linux**. Two things it cannot do: install
**Xcode** (App Store only — it will tell you), and run on **native Windows**
(use WSL2). Where it cannot install something, it says exactly what to do.

The rest of this page is that same path by hand — worth reading if the script
fails, or if you want to know what it did.

---

## What you are about to run

Keyring is a wallet. Two people exchange a **relationship credential** — a
signed statement that they met and vouched for each other — directly between
their phones.

There is one piece of infrastructure. Phones are not reachable from the
internet, so messages go through a **mediator**, which holds them until the
wallet collects them. It never reads them; everything is end-to-end encrypted.
Historically this was the hardest part of getting started, because you needed
someone else's mediator. Now you run your own with one command.

---

## 1. Install the tools

### All platforms

| Tool | Version | What it is for |
|---|---|---|
| [Git](https://git-scm.com/) | any recent | Fetching the code |
| [Node.js](https://nodejs.org) | `>=20.19.2 <21` | Runs the build and the mediator |
| Yarn | `4.9.2` | Installs dependencies |
| [JDK](https://www.azul.com/downloads/?package=jdk#zulu) | **17** | Compiles the Android app |
| [Android Studio](https://developer.android.com/studio) | latest | Android SDK + the emulator |

**Node must be in the 20.x range.** Newer versions fail in ways that are hard
to read. The repo pins the exact version in `.nvmrc`, so with
[nvm](https://github.com/nvm-sh/nvm):

```sh
nvm install 20.19.2
nvm use 20.19.2
node -v            # must print v20.19.2
```

Yarn comes from Node itself — do not `npm install -g yarn`:

```sh
corepack enable
corepack prepare yarn@4.9.2 --activate
yarn --version     # must print 4.9.2
```

**JDK 17 specifically.** Newer JDKs fail the Android build with errors that do
not mention Java. Check with `java -version`.

### Android Studio

Install it, open it once, and let it finish its first-run setup. Then:

1. **Settings → Languages & Frameworks → Android SDK → SDK Platforms**: tick
   **Android 13 (API 33)**.
2. **SDK Tools** tab: tick **Android SDK Build-Tools**, **Android SDK
   Platform-Tools**, and **Android Emulator**.
3. Apply, and let the downloads finish.

Then create a virtual device — **Device Manager** (phone icon in the sidebar) →
**Create Device** → pick **Pixel 8** → choose the **API 33** system image →
Finish. That gives you an emulator named something like `Pixel_8_API_33`.

Finally, tell your shell where the SDK lives. Add to `~/.zshrc`, `~/.bashrc`, or
your shell's equivalent:

```sh
# macOS
export ANDROID_HOME=$HOME/Library/Android/sdk
# Linux
# export ANDROID_HOME=$HOME/Android/Sdk

export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

Open a new terminal and check it worked:

```sh
adb --version           # should print a version, not "command not found"
emulator -list-avds     # should list the device you created
```

### iOS instead (macOS only)

Install Xcode from the App Store, open it once to accept the licence, and
install the iOS simulator when it offers. Then substitute `yarn demo:ios` for
`yarn demo:android` throughout. Everything else is the same.

---

## 2. Get the code

```sh
git clone --recurse-submodules https://github.com/berkmancenter/keyring-wallet.git
cd keyring-wallet
```

If you already cloned without `--recurse-submodules`, run
`git submodule update --init --recursive` now. The `bifold/` directory must not
be empty — it is most of the wallet.

```sh
yarn install
```

This takes a few minutes and prints warnings about peer dependencies. Warnings
are normal. It also builds the `bifold/` submodule as part of the install.

---

## 3. Start the emulator

Either press ▶ next to your device in Android Studio's Device Manager, or:

```sh
emulator -avd Pixel_8_API_33
```

Wait until you see the Android home screen. Confirm your machine can see it:

```sh
adb devices
```

You want one line ending in `device`. If it says `offline`, wait — it is still
booting.

---

## 4. Run the demo

```sh
yarn demo:android
```

That single command does everything: starts a mediator, writes its address into
`app/.env` for you, starts the JavaScript bundler, then builds and installs the
app. **There is nothing to configure and no file to edit.**

The first build takes **5–10 minutes** — it is compiling native code. Later runs
take under a minute. You will see a lot of Gradle output; that is expected.

You are done when the terminal shows:

```
[demo] the app is running against your local mediator.
[demo] leave this terminal open — closing it stops Metro and the mediator.
```

**Leave that terminal open.** It is running your mediator. Closing it stops the
demo. Stop everything with `Ctrl-C` when you are finished.

---

## 5. Set the wallet up

In the emulator, work through onboarding: accept the terms, choose a 6-digit
PIN, and enter a name. You can decline biometrics — on an emulator they do
nothing (see the limits below).

You end at the main screen with tabs along the bottom. The wallet is now live
and connected to your mediator.

---

## 6. Exchange a credential between two wallets

The demo that shows what Keyring is for needs **two** wallets. Both talk to the
same mediator you already have running.

Create a second emulator in Device Manager — same Pixel 8 / API 33, a different
name — and start it. `adb devices` should now list two.

In a **new** terminal (leave the first running):

```sh
adb devices     # copy the second emulator's id, e.g. emulator-5556
yarn demo:android --device emulator-5556 --metro-port 8082 --no-mediator
```

Both flags matter. `--no-mediator` builds against the mediator the first
terminal is already running, so the two wallets share one; without it the
command tries to start a second mediator and stops, because the port is taken.
`--metro-port` is needed for the same reason — the first bundler holds 8081.

Onboard the second wallet with a different name so you can tell them apart.

Then, on one wallet, start a relationship exchange and show its invitation. An
emulator's camera cannot see another emulator's screen, so instead of scanning,
use **Paste a URL** on the second wallet's scan screen and paste the invitation
the first one produced.

Both wallets end up holding a relationship credential naming the other.

---

## When something goes wrong

**`Metro's port 8081 is already in use`**
Another copy of the bundler is running — often the first wallet, or a second
checkout. Stop it, or add `--metro-port 8082`.

**`port 3010 is already in use`**
A mediator is already running, almost certainly from your first
`yarn demo:android`. If you are bringing up a second wallet, add
`--no-mediator` so it joins that one instead of starting another.

**`cloudflared is not installed`**
You asked for `--tunnel`, which you only need for physical phones. Drop the
flag; emulators do not need it.

**The app opens but stays on a blank or red screen**
The bundler is not reachable. Confirm the `yarn demo:android` terminal is still
running, then shake the device (`Ctrl-M`, or `adb shell input keyevent 82`) →
**Reload**.

**`There is no mediator to pickup messages from`**
The wallet is pointed at a mediator that is gone — usually because you restarted
the demo and the wallet still holds the old address. Re-run `yarn demo:android`,
then clear the app's data (long-press the app → App info → Storage → Clear
storage) and onboard again.

**Nothing arrives between the two wallets**
Check the mediator terminal is still running, and that both wallets were built
*after* it started. `app/.env` is read when the app is **built**, not when it
runs, so a wallet built before the mediator started holds a stale address. The
fix is to re-run `yarn demo:android` for that device.

**`adb devices` lists more than one device and the build goes to the wrong one**
Pass `--device <id>` explicitly.

**Gradle fails mentioning Java, or a version you do not recognise**
You are on the wrong JDK. `java -version` must say 17.

---

## What an emulator cannot show you

**Hardware attestation does not work on emulators.** Keyring can bind a
credential to a key held in the phone's secure hardware — the Secure Enclave on
iOS, StrongBox on Android — so the credential proves a specific physical device
was involved. Emulators have no such hardware, and the app **silently falls back
to an ordinary exchange**. Nothing warns you.

So an emulator demo shows the protocol, the exchange and the UI, but not the
hardware-backed security. That needs two physical phones:

```sh
yarn demo:android --tunnel --device <phone-id>
```

`--tunnel` is required here — a real phone cannot reach `10.0.2.2`, which is a
special address only an emulator understands — and it needs
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
installed. See [`HARDWARE_ATTESTATION_FLOW.md`](./HARDWARE_ATTESTATION_FLOW.md)
for what is proven on real devices.

---

## Where to go next

- **Build your own use case on Keyring** —
  [`app/src/demo-profiles/README.md`](../app/src/demo-profiles/README.md) has a
  ~60-line starter container to copy, and explains how to replace screens,
  style credentials without hosting anything, and package a use case.
- **How the mediator works, and its options** —
  [`bifold/packages/mediator-server/README.md`](../bifold/packages/mediator-server/README.md).
- **The witnessed exchange**, where a third party attests the exchange happened
  in person — [`DEMO_RUNBOOK_WITNESSED_EXCHANGE.md`](./DEMO_RUNBOOK_WITNESSED_EXCHANGE.md).
- **Automated tests** driving two devices end to end —
  [`e2e/README.md`](../e2e/README.md).
