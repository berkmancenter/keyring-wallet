// Fixture: a page object's own helpers (the key first), with an array of keys.
export function createSamplePage(d, io) {
  const textOfId = async (key) => io.byTestId(d, key).getAttribute("text");
  const awaitStep = async (want) => want;
  return {
    code: () => textOfId("Settings"),
    end: () => awaitStep(["Continue", "Old", "Lost"]),
    one: () => awaitStep("MyAgent"),
  };
}
