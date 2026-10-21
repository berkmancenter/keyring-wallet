#!/bin/bash
# bash e2e/gate/ci/fetch-run.test.sh: a build directory filled by another script (the Mac mini's first gate, 10-21: the
# simulator app left zipped, the run header with no wallet= or bifold=) is used as it is: fetch_run downloads nothing and
# unzips the app; build_manifest finds the iOS app's manifest, else the APK's, else says there is none. No network: a
# fake gh fails the test if it is called.
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fails=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
mkdir -p "$T/bin"; printf '#!/bin/bash\necho "gh $*" >> "%s/gh.log"; exit 1\n' "$T" > "$T/bin/gh"; chmod +x "$T/bin/gh"
D=$T/builds/abcd1234/off
mkdir -p "$D/keyring-ios-sim-abcd1234-bf00000000" "$D/keyring-android-abcd1234-bf00000000" "$T/z/KeyRing.app"
echo bundle > "$T/z/KeyRing.app/main.jsbundle"; (cd "$T/z" && zip -q -r "$D/keyring-ios-sim-abcd1234-bf00000000/keyring-sim.zip" KeyRing.app)
printf 'wallet=abcd1234ios\nbifold=bf00ios\n' > "$D/keyring-ios-sim-abcd1234-bf00000000/manifest.txt"
echo apk > "$D/keyring-android-abcd1234-bf00000000/keyring-release-test.apk"
printf 'wallet=abcd1234apk\nbifold=bf00apk\n' > "$D/keyring-android-abcd1234-bf00000000/manifest.txt"
out=$( ( export PATH="$T/bin:$PATH" GATE_HOME=$T/home; . "$here/../lib.sh" >/dev/null 2>&1; fetch_run 12345 "$D"; echo "rc=$?" ) 2>&1 )
case $out in *rc=0) ok "a pre-filled build directory is accepted";; *) bad "fetch_run on a pre-filled directory: $out";; esac
[ -f "$D/keyring-ios-sim-abcd1234-bf00000000/KeyRing.app/main.jsbundle" ] && ok "its zipped simulator app is unzipped" || bad "the simulator app is still zipped"
[ ! -s "$T/gh.log" ] && ok "nothing is downloaded again" || bad "gh was called: $(cat "$T/gh.log")"
APP=$D/keyring-ios-sim-abcd1234-bf00000000/KeyRing.app; APK=$D/keyring-android-abcd1234-bf00000000/keyring-release-test.apk
bm() { ( export GATE_HOME=$T/home; . "$here/../lib.sh" >/dev/null 2>&1; build_manifest "$@"; echo " rc=$?" ); }
case $(bm "$APP" "$APK") in *ios-sim*manifest.txt" rc=0") ok "with an iOS app, its manifest is the build's";; *) bad "iOS manifest not chosen: $(bm "$APP" "$APK")";; esac
case $(bm "" "$APK") in *android*manifest.txt" rc=0") ok "with no iOS app, the APK's manifest names the build";; *) bad "APK manifest not chosen: $(bm "" "$APK")";; esac
case $(bm "" "") in " rc=1") ok "with neither, no manifest is claimed";; *) bad "a manifest was claimed from nothing: $(bm "" "")";; esac
# use_build with no manifest anywhere: a release gate stops; another kind warns and goes on. build_runs and fetch_run are
# stubbed: only the manifest decision is under test.
E=$T/builds/eeee0000/off; mkdir -p "$E/keyring-android-x"; echo apk > "$E/keyring-android-x/a.apk"
ub() { ( export GATE_HOME=$T/home2; mkdir -p "$T/home2/builds"; ln -sfn "$T/builds/eeee0000" "$T/home2/builds/eeee0000"
  . "$here/../lib.sh" >/dev/null 2>&1; build_runs() { echo "1 -"; }; fetch_run() { :; }; gh() { :; }
  kind=$1; use_build eeee0000ffff; echo "rc=$?" ) 2>&1; }
case $(ub gate) in *"must name the wallet and bifold"*) ok "a release gate with no build manifest stops";; *) bad "a gate went on without a manifest: $(ub gate | tail -2)";; esac
case $(ub dry) in *"will not name the wallet"*rc=0) ok "a dry run with no build manifest warns and goes on";; *) bad "a dry run without a manifest: $(ub dry | tail -2)";; esac
[ $fails = 0 ] && echo "fetch-run: all passed" || { echo "fetch-run: $fails failed"; exit 1; }
