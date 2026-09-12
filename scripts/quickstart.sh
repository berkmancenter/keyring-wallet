#!/usr/bin/env bash
#
# yarn quickstart — check the toolchain, install what is missing, run the demo.
#
# Written in bash rather than Node on purpose: it may have to install Node
# itself, and a Node script cannot run before Node exists. It also cannot change
# the PATH of the shell that invoked it, so anything it installs is exported for
# this run and, with your say-so, appended to your shell profile for later ones.
#
# Supports macOS and Linux. On Windows use WSL2 and run it there — the native
# Windows toolchain is not supported (the demo runner relies on POSIX process
# groups to shut the mediator and bundler down).
#
#   yarn quickstart                 # check, install what is missing, run
#   yarn quickstart --check         # report only; install nothing, run nothing
#   yarn quickstart --no-install    # check and run, but never install
#   yarn quickstart --yes           # do not prompt before installing
#   yarn quickstart --ios           # target the iOS simulator (macOS)
#
# Anything after `--` is passed through to the demo runner, e.g.
#   yarn quickstart -- --device emulator-5556 --no-mediator

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

NODE_VERSION="$(cat .nvmrc 2>/dev/null || echo 20.19.2)"
YARN_VERSION="4.9.2"
ANDROID_API="33"
AVD_NAME="Keyring_API_${ANDROID_API}"

PLATFORM="android"
DO_INSTALL=1
DO_RUN=1
ASSUME_YES=0
DEMO_ARGS=()

MISSING=()
NOTES=()

# ---------------------------------------------------------------- presentation

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
step() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }
die()  { printf '\n%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

confirm() {
  [ "$ASSUME_YES" = "1" ] && return 0
  [ -t 0 ] || die "cannot prompt (no terminal). Re-run with --yes to install without asking, or --no-install."
  printf '\n%s [y/N] ' "$1"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

# ------------------------------------------------------------------------ args

while [ $# -gt 0 ]; do
  case "$1" in
    --check)      DO_INSTALL=0; DO_RUN=0 ;;
    --no-install) DO_INSTALL=0 ;;
    --yes|-y)     ASSUME_YES=1 ;;
    --ios)        PLATFORM="ios" ;;
    --android)    PLATFORM="android" ;;
    --help|-h)    sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'; exit 0 ;;
    --)           shift; DEMO_ARGS=("$@"); break ;;
    *)            die "unknown argument \"$1\" — run with --help" ;;
  esac
  shift
done

# -------------------------------------------------------------------- platform

case "$(uname -s)" in
  Darwin) OS="macos" ;;
  Linux)  OS="linux" ;;
  MINGW*|MSYS*|CYGWIN*)
    die "native Windows is not supported. Install WSL2, clone the repo inside it, and run this there." ;;
  *) die "unsupported operating system: $(uname -s)" ;;
esac

if [ "$OS" = "linux" ] && [ "$PLATFORM" = "ios" ]; then
  die "the iOS simulator only exists on macOS. Use --android."
fi

if command -v apt-get >/dev/null 2>&1; then PKG="apt"
elif command -v dnf >/dev/null 2>&1;     then PKG="dnf"
elif command -v pacman >/dev/null 2>&1;  then PKG="pacman"
elif command -v brew >/dev/null 2>&1;    then PKG="brew"
else PKG="none"
fi

sudo_prefix() { [ "$(id -u)" = "0" ] && echo "" || echo "sudo"; }

# ------------------------------------------------------------------ nvm / node

NVM_DIR_DEFAULT="${NVM_DIR:-$HOME/.nvm}"

load_nvm() {
  # shellcheck disable=SC1091
  if [ -s "$NVM_DIR_DEFAULT/nvm.sh" ]; then
    export NVM_DIR="$NVM_DIR_DEFAULT"
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    return 0
  fi
  return 1
}

node_version_ok() {
  command -v node >/dev/null 2>&1 || return 1
  [ "$(node -p 'process.versions.node.split(".")[0]')" = "20" ]
}

install_node() {
  if ! load_nvm; then
    say "  installing nvm (Node version manager)…"
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash >/dev/null
    load_nvm || die "nvm installed but could not be loaded — open a new terminal and re-run"
  fi
  say "  installing Node ${NODE_VERSION} via nvm…"
  nvm install "$NODE_VERSION" >/dev/null
  nvm use "$NODE_VERSION" >/dev/null
}

# ------------------------------------------------------------------------ java

java_17_ok() {
  command -v java >/dev/null 2>&1 || return 1
  java -version 2>&1 | head -1 | grep -qE '"(1\.)?17'
}

install_java() {
  case "$PKG" in
    brew) brew install --cask zulu@17 ;;
    apt)  $(sudo_prefix) apt-get update && $(sudo_prefix) apt-get install -y openjdk-17-jdk ;;
    dnf)  $(sudo_prefix) dnf install -y java-17-openjdk-devel ;;
    pacman) $(sudo_prefix) pacman -S --noconfirm jdk17-openjdk ;;
    *) die "no supported package manager found — install JDK 17 manually: https://www.azul.com/downloads/?package=jdk" ;;
  esac
}

# ------------------------------------------------------------------- android sdk

default_sdk_root() {
  if [ "$OS" = "macos" ]; then echo "$HOME/Library/Android/sdk"; else echo "$HOME/Android/Sdk"; fi
}

ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$(default_sdk_root)}}"

sdk_tool() { # sdk_tool <relative path> -> absolute, or empty
  local candidate="$ANDROID_SDK/$1"
  [ -x "$candidate" ] && echo "$candidate"
}

find_sdkmanager() {
  sdk_tool "cmdline-tools/latest/bin/sdkmanager" || sdk_tool "cmdline-tools/bin/sdkmanager" || command -v sdkmanager 2>/dev/null || true
}

install_cmdline_tools() {
  local url zip tmp
  if [ "$OS" = "macos" ]; then
    url="https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip"
  else
    url="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  fi
  tmp="$(mktemp -d)"
  zip="$tmp/cmdline-tools.zip"
  say "  downloading the Android command-line tools…"
  curl -fsSL "$url" -o "$zip"
  mkdir -p "$ANDROID_SDK/cmdline-tools"
  unzip -q "$zip" -d "$tmp"
  rm -rf "$ANDROID_SDK/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$ANDROID_SDK/cmdline-tools/latest"
  rm -rf "$tmp"
}

install_android_packages() {
  local sdkmanager
  sdkmanager="$(find_sdkmanager)"
  [ -n "$sdkmanager" ] || die "sdkmanager not found after installing the command-line tools"

  say "  accepting Android SDK licences…"
  yes 2>/dev/null | "$sdkmanager" --sdk_root="$ANDROID_SDK" --licenses >/dev/null 2>&1 || true

  say "  installing platform-tools, emulator and the API ${ANDROID_API} system image (this is a large download)…"
  "$sdkmanager" --sdk_root="$ANDROID_SDK" \
    "platform-tools" \
    "emulator" \
    "platforms;android-${ANDROID_API}" \
    "system-images;android-${ANDROID_API};google_apis;${SYSTEM_IMAGE_ARCH}" >/dev/null
}

create_avd() {
  local avdmanager
  avdmanager="$(sdk_tool "cmdline-tools/latest/bin/avdmanager" || true)"
  [ -n "$avdmanager" ] || die "avdmanager not found"
  say "  creating the emulator \"${AVD_NAME}\"…"
  echo "no" | "$avdmanager" create avd \
    --name "$AVD_NAME" \
    --package "system-images;android-${ANDROID_API};google_apis;${SYSTEM_IMAGE_ARCH}" \
    --device "pixel_6" >/dev/null
}

# Apple silicon emulators need arm64 images; everything else uses x86_64.
if [ "$OS" = "macos" ] && [ "$(uname -m)" = "arm64" ]; then
  SYSTEM_IMAGE_ARCH="arm64-v8a"
else
  SYSTEM_IMAGE_ARCH="x86_64"
fi

# --------------------------------------------------------------------- profile

shell_profile() {
  case "$(basename "${SHELL:-bash}")" in
    zsh)  echo "$HOME/.zshrc" ;;
    bash) [ "$OS" = "macos" ] && echo "$HOME/.bash_profile" || echo "$HOME/.bashrc" ;;
    *)    echo "$HOME/.profile" ;;
  esac
}

persist_android_env() {
  local profile marker
  profile="$(shell_profile)"
  marker="# added by keyring quickstart"
  if grep -q "$marker" "$profile" 2>/dev/null; then return 0; fi
  {
    echo ""
    echo "$marker"
    echo "export ANDROID_HOME=\"$ANDROID_SDK\""
    echo 'export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"'
  } >> "$profile"
  NOTES+=("Added ANDROID_HOME and PATH to $profile — open a new terminal for them to apply outside this run.")
}

# ----------------------------------------------------------------------- checks

step "Checking your toolchain (${OS}, $(uname -m), target: ${PLATFORM})"

load_nvm || true

if node_version_ok; then
  ok "Node $(node -v)"
else
  bad "Node 20.x (found: $(command -v node >/dev/null 2>&1 && node -v || echo 'not installed'))"
  MISSING+=("node")
fi

if command -v git >/dev/null 2>&1; then ok "git"; else bad "git"; MISSING+=("git"); fi

if [ "$PLATFORM" = "android" ]; then
  if java_17_ok; then
    ok "JDK 17"
  else
    bad "JDK 17 (found: $(command -v java >/dev/null 2>&1 && java -version 2>&1 | head -1 || echo 'not installed'))"
    MISSING+=("java")
  fi

  if [ -n "$(find_sdkmanager)" ]; then ok "Android command-line tools"; else bad "Android command-line tools"; MISSING+=("cmdline-tools"); fi
  if [ -n "$(sdk_tool platform-tools/adb)" ] || command -v adb >/dev/null 2>&1; then ok "adb"; else bad "adb (platform-tools)"; MISSING+=("android-packages"); fi
  if [ -n "$(sdk_tool emulator/emulator)" ] || command -v emulator >/dev/null 2>&1; then ok "Android emulator"; else bad "Android emulator"; MISSING+=("android-packages"); fi

  AVD_LIST=""
  if EMU="$(sdk_tool emulator/emulator || command -v emulator 2>/dev/null)"; then
    AVD_LIST="$("$EMU" -list-avds 2>/dev/null | grep -v '^INFO' || true)"
  fi
  if [ -n "$AVD_LIST" ]; then
    ok "a virtual device exists ($(echo "$AVD_LIST" | head -1))"
  else
    bad "no Android virtual device"
    MISSING+=("avd")
  fi
else
  if xcode-select -p >/dev/null 2>&1; then
    ok "Xcode command-line tools"
  else
    bad "Xcode"
    NOTES+=("Xcode cannot be installed by a script — get it from the App Store, open it once to accept the licence, then re-run.")
    MISSING+=("xcode-manual")
  fi
  if command -v pod >/dev/null 2>&1; then ok "CocoaPods"; else bad "CocoaPods"; MISSING+=("cocoapods"); fi
fi

# --------------------------------------------------------------------- install

if [ ${#MISSING[@]} -eq 0 ]; then
  step "Everything needed is present."
else
  if [ "$DO_INSTALL" = "0" ]; then
    step "Missing: ${MISSING[*]}"
    say "  (not installing — you passed --check or --no-install)"
    say "  Run ${BOLD}yarn quickstart${RESET} to install them and start the demo."
    if [ "$DO_RUN" = "0" ]; then
      for n in "${NOTES[@]:-}"; do [ -n "$n" ] && warn "$n"; done
      # Non-zero so `yarn doctor` is usable as a gate in a script or CI.
      exit 1
    fi
    die "cannot run the demo until the above are installed"
  fi

  step "Missing: ${MISSING[*]}"
  for item in "${MISSING[@]}"; do
    case "$item" in
      git) die "git is missing, but you must already have it to have cloned this repo — install it and re-run." ;;
      xcode-manual) die "Xcode must be installed by hand. See the note above." ;;
    esac
  done

  confirm "Install these now?" || die "nothing installed. Install them yourself, or re-run without --check."

  for item in "${MISSING[@]}"; do
    case "$item" in
      node)             install_node ;;
      java)             install_java ;;
      cmdline-tools)    install_cmdline_tools ;;
      android-packages) install_android_packages ;;
      avd)              install_android_packages; create_avd ;;
      cocoapods)        $(sudo_prefix) gem install cocoapods ;;
    esac
  done

  if [ "$PLATFORM" = "android" ]; then
    export ANDROID_HOME="$ANDROID_SDK"
    export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
    persist_android_env
  fi

  step "Re-checking"
  node_version_ok && ok "Node $(node -v)" || die "Node is still not 20.x — open a new terminal and re-run"
  if [ "$PLATFORM" = "android" ]; then
    java_17_ok && ok "JDK 17" || die "JDK 17 is still not the active java — check JAVA_HOME"
    command -v adb >/dev/null 2>&1 && ok "adb" || die "adb still not on PATH"
  fi
fi

# --------------------------------------------------------------------- report

if [ "$DO_RUN" = "0" ]; then
  step "Check complete."
  say "  Dependencies were not installed and the demo was not run (--check)."
  say "  Run ${BOLD}yarn quickstart${RESET} to do both."
  for n in "${NOTES[@]:-}"; do [ -n "$n" ] && warn "$n"; done
  exit 0
fi

# --------------------------------------------------------------- yarn and deps

step "Preparing yarn ${YARN_VERSION}"
corepack enable >/dev/null 2>&1 || true
corepack prepare "yarn@${YARN_VERSION}" --activate >/dev/null 2>&1 || true
ok "yarn $(yarn --version 2>/dev/null || echo '(unavailable)')"

if [ ! -d bifold/packages ] || [ -z "$(ls -A bifold 2>/dev/null)" ]; then
  step "Fetching the bifold submodule"
  git submodule update --init --recursive
fi

step "Installing dependencies (a few minutes the first time)"
yarn install

# ------------------------------------------------------------------- emulator

if [ "$PLATFORM" = "android" ]; then
  if ! adb devices 2>/dev/null | awk 'NR>1 && $2=="device"' | grep -q .; then
    AVD_TO_BOOT="$(emulator -list-avds 2>/dev/null | grep -v '^INFO' | head -1 || true)"
    [ -n "$AVD_TO_BOOT" ] || die "no Android virtual device to start — re-run without --no-install to create one"
    step "Starting the emulator \"$AVD_TO_BOOT\" (this takes a minute)"
    nohup emulator -avd "$AVD_TO_BOOT" -gpu swiftshader_indirect -no-audio -no-snapshot >/dev/null 2>&1 &
    for _ in $(seq 1 60); do
      [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
      sleep 5
    done
    [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] \
      || die "the emulator did not finish booting — start it from Android Studio and re-run"
    ok "emulator ready"
  else
    ok "a device is already connected"
  fi
fi

# ----------------------------------------------------------------------- demo

for n in "${NOTES[@]:-}"; do [ -n "$n" ] && warn "$n"; done

step "Starting the demo"
say "${DIM}Leave this terminal open — it runs the mediator and the bundler.${RESET}"
exec yarn "demo:${PLATFORM}" ${DEMO_ARGS[@]+"${DEMO_ARGS[@]}"}
