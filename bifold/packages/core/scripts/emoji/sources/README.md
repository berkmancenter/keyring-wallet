# Vendored emoji sources

Inputs to `../generate-emoji-data.mjs`. They are byte-identical copies of the upstream files, kept here so the generator runs offline and its output is reproducible. They live under `scripts/`, so they are not part of the app bundle; only the generated `src/modules/chat/emoji/emoji-data.json` ships.

| File | Upstream | Version | sha256 |
|---|---|---|---|
| `emoji-test.txt` | https://www.unicode.org/Public/18.0.0/emoji/emoji-test.txt | Unicode Emoji 18.0 (file dated 2026-04-30) | `8f3735cda1f92a779d78af67cf86066bb1f07143dc22f2ac29394d9bc57ab21a` |
| `cldr-annotations-en.json` | https://raw.githubusercontent.com/unicode-org/cldr-json/49.0.0/cldr-json/cldr-annotations-full/annotations/en/annotations.json | CLDR 49.0.0 | `6b6b6e0e5f211bc31cf3fa39f385d80dea6cd19ee19bbc6db9071fce3ae5d360` |
| `cldr-annotations-derived-en.json` | https://raw.githubusercontent.com/unicode-org/cldr-json/49.0.0/cldr-json/cldr-annotations-derived-full/annotationsDerived/en/annotations.json | CLDR 49.0.0 | `7aad034f689cb6553f8d7366bfee8c4ea2818c7776907bc5118aab575223dea3` |

## Licences

All three files are published by Unicode, Inc. under the Unicode License v3, which permits redistribution provided the copyright and permission notice is included:

- `LICENSE-unicode.txt` — https://www.unicode.org/license.txt (covers the Unicode data files, including `emoji-test.txt`).
- `LICENSE-cldr-json.txt` — https://github.com/unicode-org/cldr-json/blob/49.0.0/LICENSE (covers the CLDR JSON files).

## Updating

1. Download the new files from the URLs above with the new version in the path, replacing these.
2. Update `UNICODE_EMOJI_VERSION`, `CLDR_VERSION` and the URLs in `SOURCES` in the generator, and the table above.
3. Run `yarn emoji` in `packages/core`, then `yarn emoji:test`.
4. Check the OS-version table in `src/modules/chat/emoji/osSupport.ts`: a new emoji version needs a row before any OS draws it, or the picker will (correctly) keep hiding it.
