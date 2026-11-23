#!/usr/bin/env python3
"""Export a Design-canvas artifact's artboards to PNGs and a contact sheet, for a plan's canvas/ folder.

Usage:
  python3 -I scripts/plans/export-canvas.py <saved-artifact-dir> <out-dir> <version-label>

<saved-artifact-dir> is where the Artifact tool saved the canvas's files: project/canvas.json,
project/*.dc.html and the shared stylesheet (<asset-id>.css). Each artboard is rebuilt as a plain
page (the <helmet> hoisted into <head>, the shared stylesheet inlined, the runtime script dropped)
and rendered with headless Chrome at the board's size, twice the pixel density. The contact sheet
is three frames to a row with each board's title. Writes <out-dir>/NN-<name>.png, sheet.png and
README.md; the caller commits them. Needs CHROMIUM (path to a Chrome or Chromium binary).
"""
import html
import json
import os
import re
import subprocess
import sys
import tempfile

src, out, label = sys.argv[1], sys.argv[2], sys.argv[3]
chrome = os.environ.get("CHROMIUM", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
os.makedirs(out, exist_ok=True)

canvas = json.load(open(os.path.join(src, "project", "canvas.json")))
boards = canvas["boards"]
order = canvas["order"]
css_files = [f for f in os.listdir(src) if f.endswith(".css")]
shared_css = open(os.path.join(src, css_files[0])).read() if css_files else ""


def static_page(dc_html: str) -> str:
    helmet = re.search(r"<helmet>(.*?)</helmet>", dc_html, re.S)
    body = re.search(r"</helmet>(.*?)</x-dc>", dc_html, re.S)
    head = helmet.group(1) if helmet else ""
    inner = body.group(1) if body else dc_html
    # Links are navigation in the canvas, not content. A header's first link is its back arrow, which the
    # stylesheet pins to the left edge through ".hd a, .hd .bk"; the replacement span keeps that rule by class.
    inner = re.sub(r'(<div class="hd">)<a\b', r'\1<span class="bk" data-link', inner)
    inner = re.sub(r"<a\b", "<span data-link", inner)
    inner = inner.replace("</a>", "</span>")
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        f"<style>{shared_css}</style>{head}"
        "<style>html,body{margin:0;background:#fff}</style></head><body>"
        f"{inner}</body></html>"
    )


def shoot(page_html: str, w: int, h: int, png: str) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(page_html)
        path = f.name
    subprocess.run(
        [
            chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
            "--force-device-scale-factor=2", f"--window-size={w},{h}", "--virtual-time-budget=4000",
            f"--screenshot={png}", f"file://{path}",
        ],
        check=True, capture_output=True,
    )
    os.unlink(path)


rows = []
for i, name in enumerate(order, 1):
    b = boards[name]
    dc = open(os.path.join(src, "project", name)).read()
    slug = re.sub(r"[^a-z0-9]+", "-", re.sub(r"(?<=[a-z])(?=[A-Z])", "-", name.replace(".dc.html", "")).lower()).strip("-")
    png = os.path.join(out, f"{i:02d}-{slug}.png")
    shoot(static_page(dc), b["w"], b["h"], png)
    rows.append((i, os.path.basename(png), b["title"], b["w"], b["h"]))
    print(png)

# Contact sheet: three to a row, captions under each frame.
cells = "".join(
    f'<figure><img src="file://{os.path.abspath(os.path.join(out, f))}" style="width:{w/2}px"><figcaption>{html.escape(f)}<br>{html.escape(t)}</figcaption></figure>'
    for _, f, t, w, h in rows
)
sheet_html = (
    "<!doctype html><html><head><meta charset=\"utf-8\"><style>"
    "body{margin:0;padding:24px;background:#F3F2F0;font-family:'Source Sans 3',system-ui,sans-serif;width:1920px}"
    ".g{display:grid;grid-template-columns:repeat(3,1fr);gap:28px 24px;align-items:start}"
    "figure{margin:0;display:flex;flex-direction:column;gap:8px}img{display:block;border:1px solid #D9D6D0;max-width:100%;height:auto}"
    "figcaption{font-size:15px;line-height:20px;color:#333}"
    "</style></head><body><div class='g'>" + cells + "</div></body></html>"
)
sheet = os.path.join(out, "sheet.png")
rows_n = (len(rows) + 2) // 3
shoot(sheet_html, 1968, 24 + rows_n * (844 // 2 + 64 + 28) + 400, sheet)
print(sheet)

readme = [
    "# The UI/UX canvas, exported",
    "",
    f"Exported from the UI/UX lane's canvas, artifact version `{label}`, by `scripts/plans/export-canvas.py`.",
    "One PNG per artboard, in the canvas's order, rendered with headless Chrome at the board's size at twice the",
    "pixel density from the published artboard files and their shared stylesheet; `sheet.png` is all of them, three",
    "to a row. These are the visual target for the screens (the plan's section 8.5); the kit SVGs in `../mockups/`",
    "remain the checked source for the copy. Re-export when a new canvas version is approved.",
    "",
    "| # | File | Board | Size |",
    "|---|---|---|---|",
]
for i, f, t, w, h in rows:
    readme.append(f"| {i} | `{f}` | {t} | {w}×{h} |")
open(os.path.join(out, "README.md"), "w").write("\n".join(readme) + "\n")
print(os.path.join(out, "README.md"))
