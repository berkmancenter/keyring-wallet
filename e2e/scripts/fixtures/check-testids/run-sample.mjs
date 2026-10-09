// Fixture: an allowlisted older-build key and a known one.
import { tapTestId } from "./lib/driver.js";

export const run = async (d) => {
  await tapTestId(d, "Old");
  await tapTestId(d, "Continue");
};
