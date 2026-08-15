#!/bin/zsh
# ref-03b — run the noble HPKE probe on Node and on the app's Hermes VM, diff outputs.
# Requires: external/vta-browser-plugin checked out at feat/pure-js-crypto-backend,
#           app pods installed (for the Hermes binary), app node_modules (for the RN Babel preset).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PLUGIN="$ROOT/external/vta-browser-plugin"
HERMES="$ROOT/app/ios/Pods/hermes-engine/destroot/bin/hermes"
WORK="$HERE/.work"
mkdir -p "$WORK"

# 1. Bundle the probe + the PR branch's hpke-noble.ts + the CFRG vector into one es2020 file.
NODE_PATH="$PLUGIN/packages/tsp-js/node_modules:$PLUGIN/node_modules" \
  "$PLUGIN/node_modules/.bin/esbuild" "$HERE/probe.mts" \
  --bundle --format=iife --target=es2020 --outfile="$WORK/probe.es2020.js"

# 2. Lower for Hermes with React Native's own Babel preset — the same transform
#    Metro applies in production (Hermes has no native class syntax).
cd "$ROOT/app" && node -e '
const babel = require("@babel/core");
const fs = require("fs");
const W = process.argv[1];
const out = babel.transformFileSync(W + "/probe.es2020.js", {
  presets: [["@react-native/babel-preset", { disableImportExportTransform: true, enableBabelRuntime: false }]],
  configFile: false, babelrc: false, compact: false,
});
fs.writeFileSync(W + "/probe.hermes.js", out.code);
' "$WORK"

# 3. Same file, two engines.
node "$WORK/probe.hermes.js" | tee "$HERE/out-node.txt"
"$HERMES" "$WORK/probe.hermes.js" | tee "$HERE/out-hermes.txt"

# 4. Byte-compare (only the engine banner and reported WebCrypto surface may differ).
echo "--- diff (expected: engine banner + webcrypto surface lines only) ---"
diff "$HERE/out-node.txt" "$HERE/out-hermes.txt" || true
grep -q "RESULT: ALL PASS" "$HERE/out-node.txt" && grep -q "RESULT: ALL PASS" "$HERE/out-hermes.txt" \
  && [ "$(grep transcript-sha256 "$HERE/out-node.txt")" = "$(grep transcript-sha256 "$HERE/out-hermes.txt")" ] \
  && echo "ref-03b: PASS — transcripts byte-identical across engines"
