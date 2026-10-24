// Section rules read from ONE page source.
//
// #341's check (run-agent-header.mjs, "settings-section-rules") asked Appium for a section's position and then for
// every rule's position, one call each, right after scrolling the section into view. On 2026-10-15 it failed on both
// platforms while the page dumped in the same row showed the rule in place (Android: rule y1473, Details y1558; iOS:
// rule y559, Details y591): the Activity list above had grown, so Details now needs a scroll, and the positions were
// read across it. One page source is one moment, so a section and the rules are compared in the same layout.

/** Every element with an app testID in a page source: { id, y } (Android `bounds`, iOS `y`). */
export function elementsWithY(source) {
  const out = [];
  for (const tag of String(source).match(/<[^>]+>/g) || []) {
    const id = tag.match(/(?:resource-id|name)="com\.ariesbifold:id\/([^"]+)"/)?.[1];
    if (!id) continue;
    const b = tag.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/);
    const y = b ? Number(b[2]) : Number(tag.match(/\sy="(-?\d+)"/)?.[1]);
    if (Number.isFinite(y)) out.push({ id, y });
  }
  return out;
}

/**
 * ruledAbove(source, id, { rule, maxGap }): whether a `rule` element sits above `id` within maxGap (same units as the
 * source: px on Android, points on iOS). undefined when `id` is not in the source.
 */
export function ruledAbove(source, id, { rule = "AgentSectionRule", maxGap = 160 } = {}) {
  const els = elementsWithY(source);
  const el = els.find((e) => e.id === id);
  if (!el) return undefined;
  return els.some((e) => e.id === rule && e.y >= 0 && e.y < el.y && el.y - e.y <= maxGap);
}
