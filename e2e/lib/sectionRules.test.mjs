import { test } from "node:test";
import assert from "node:assert/strict";
import { elementsWithY, ruledAbove } from "./sectionRules.js";

// The Android dump from the 1015-1631 smoke-android row that failed (bounds in px).
const ANDROID = `
<android.view.View resource-id="com.ariesbifold:id/AgentSectionRule" bounds="[53,949][1028,950]" />
<android.view.View resource-id="com.ariesbifold:id/AgentSectionRule" bounds="[53,992][1028,993]" />
<android.view.ViewGroup resource-id="com.ariesbifold:id/AgentActivity" bounds="[53,1035][1028,1431]" />
<android.view.View resource-id="com.ariesbifold:id/AgentSectionRule" bounds="[53,1473][1028,1474]" />
<android.view.ViewGroup resource-id="com.ariesbifold:id/AgentDetailsToggle" bounds="[95,1558][986,1674]" />
<android.view.View resource-id="com.ariesbifold:id/AgentSectionRule" bounds="[53,1758][1028,1759]" />
<android.widget.Button resource-id="com.ariesbifold:id/AgentUnlink" bounds="[53,1801][1028,1950]" />`;

// The iOS dump from the 1015-1852 smoke-ios row that failed (points).
const IOS = `
<XCUIElementTypeOther name="com.ariesbifold:id/AgentSectionRule" x="20" y="361" width="362" height="1"/>
<XCUIElementTypeOther name="com.ariesbifold:id/AgentSectionRule" x="20" y="377" width="362" height="1"/>
<XCUIElementTypeOther name="com.ariesbifold:id/AgentActivity" x="20" y="394" width="362" height="150"/>
<XCUIElementTypeOther name="com.ariesbifold:id/AgentSectionRule" x="20" y="559" width="362" height="1"/>
<XCUIElementTypeButton name="com.ariesbifold:id/AgentDetailsToggle" x="36" y="591" width="330" height="45"/>
<XCUIElementTypeOther name="com.ariesbifold:id/AgentSectionRule" x="20" y="667" width="362" height="1"/>
<XCUIElementTypeButton name="com.ariesbifold:id/AgentUnlink" x="20" y="684" width="362" height="56"/>`;

test("reads ids and tops on both platforms", () => {
  assert.deepEqual(elementsWithY(ANDROID).find((e) => e.id === "AgentDetailsToggle"), { id: "AgentDetailsToggle", y: 1558 });
  assert.deepEqual(elementsWithY(IOS).find((e) => e.id === "AgentDetailsToggle"), { id: "AgentDetailsToggle", y: 591 });
});

test("the two dumps whose rows failed are ruled above every section, read from one source", () => {
  for (const src of [ANDROID, IOS])
    for (const id of ["AgentActivity", "AgentDetailsToggle", "AgentUnlink"]) assert.equal(ruledAbove(src, id), true, id);
});

test("a section with no rule close above it is not ruled", () => {
  const noRule = ANDROID.replace('bounds="[53,1473][1028,1474]"', 'bounds="[53,1200][1028,1201]"');
  assert.equal(ruledAbove(noRule, "AgentDetailsToggle"), false);
});

test("a rule below the section does not count", () => {
  const below = `<a resource-id="com.ariesbifold:id/AgentDetailsToggle" bounds="[0,500][10,560]"/><b resource-id="com.ariesbifold:id/AgentSectionRule" bounds="[0,570][10,571]"/>`;
  assert.equal(ruledAbove(below, "AgentDetailsToggle"), false);
});

test("a section missing from the source is unknown, not unruled", () => {
  assert.equal(ruledAbove(IOS, "AgentNotThere"), undefined);
});
