#!/bin/zsh
# ref-03d — run the BLS12-381 probe on Node and on the app's Hermes VM, diff outputs.
# Same harness shape as ref-03b: esbuild bundle → RN Babel lowering → two engines.
# Requires: external/vta-browser-plugin node_modules (for @noble/curves 2.x + esbuild),
#           app pods installed (for the Hermes binary), app node_modules (RN Babel preset).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PLUGIN="$ROOT/external/vta-browser-plugin"
HERMES="$ROOT/app/ios/Pods/hermes-engine/destroot/bin/hermes"
WORK="$HERE/.work"
mkdir -p "$WORK"

NODE_PATH="$PLUGIN/node_modules" \
  "$PLUGIN/node_modules/.bin/esbuild" "$HERE/probe.mts" \
  --bundle --format=iife --target=es2020 \
  --outfile="$WORK/probe.es2020.js"

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

node "$WORK/probe.hermes.js" | tee "$HERE/out-node.txt"
"$HERMES" "$WORK/probe.hermes.js" | tee "$HERE/out-hermes.txt"

echo "--- diff (expected: engine banner, webcrypto surface, timing lines only) ---"
diff "$HERE/out-node.txt" "$HERE/out-hermes.txt" || true
grep -q "RESULT: ALL PASS" "$HERE/out-node.txt" && grep -q "RESULT: ALL PASS" "$HERE/out-hermes.txt" \
  && [ "$(grep transcript-sha256 "$HERE/out-node.txt")" = "$(grep transcript-sha256 "$HERE/out-hermes.txt")" ] \
  && echo "ref-03d: PASS — BLS12-381 transcripts byte-identical across engines"
