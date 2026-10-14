// Fixture: a page object's unit test, which the checker leaves out.
import { createSamplePage } from "./sample.js";
export const t = () => createSamplePage({}, {}).end(["NotAnId"]);
