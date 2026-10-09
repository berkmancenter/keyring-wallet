// Fixture for check-testids.test.mjs: one of each kind of reference.
import { byTestId, existsTestId, tapTestId } from "./lib/driver.js";

export async function run(d, key, id) {
  await tapTestId(d, "Settings", 15000);
  await existsTestId(d, "WitnessedBadge");
  await tapTestId(d, `AgentDevice_${key}`);
  const el = byTestId(d, "ToggleDeveloper");
  await tapTestId(d, "Renamed");
  await existsTestId(d, "Not Here");
  await existsTestId(d, id);
  await d.$$(`//*[starts-with(@resource-id,"com.ariesbifold:id/Gone_")]`);
  return el;
}
