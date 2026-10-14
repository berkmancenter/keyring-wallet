// Fixture: a unit test's own fixture key must not be checked.
import { tapTestId } from "./driver.js";
await tapTestId({}, "FixtureOnlyKey");
