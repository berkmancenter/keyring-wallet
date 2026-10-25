// PNG -> BMP for the filled-button measure, with no dependency beyond a system
// tool: `sips` on macOS, ImageMagick (`magick`, else `convert`) elsewhere.
// Kept apart from filledButtons.js so the command choice can be tested offline.
import { execFileSync, spawnSync } from "node:child_process";

/**
 * The command that turns `png` into a 24-bit BMP at `bmp`, or throws if the
 * platform has no usable tool. `has(cmd)` says whether a command is on PATH.
 * macOS behaviour is unchanged (sips); ImageMagick is the fallback elsewhere,
 * `bmp3:` + TrueColor + no alpha so the output is the 24-bit form fillShareOfBmp reads.
 */
export function pngToBmpCommand(platform, has, png, bmp) {
  if (platform === "darwin" && has("sips")) {
    return ["sips", ["-s", "format", "bmp", png, "--out", bmp]];
  }
  for (const im of ["magick", "convert"]) {
    if (has(im)) return [im, [`png:${png}`, "-alpha", "off", "-type", "TrueColor", `bmp3:${bmp}`]];
  }
  throw new Error(
    platform === "darwin"
      ? "no sips or ImageMagick (magick/convert) on PATH"
      : "ImageMagick (magick or convert) is required to measure filled buttons on this platform",
  );
}

/** Whether `cmd` can be launched at all (its exit code is irrelevant). */
export function onPath(cmd) {
  const r = spawnSync(cmd, ["-version"], { stdio: "ignore" });
  return r.error?.code !== "ENOENT";
}

/** Run the conversion with the tool this machine has. */
export function convertPngToBmp(png, bmp) {
  const [cmd, args] = pngToBmpCommand(process.platform, onPath, png, bmp);
  execFileSync(cmd, args, { stdio: "ignore" });
}
