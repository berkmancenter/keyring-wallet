// Fixture: a helper passing its key through (dynamic) and one known key.
import { byTestId, tapTestId } from "./driver.js";

export const textOf = async (d, key) => byTestId(d, key).getAttribute("text");
export const openAgent = (d) => tapTestId(d, "MyAgent");
