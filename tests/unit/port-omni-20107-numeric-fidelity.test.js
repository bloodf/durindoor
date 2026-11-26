import { describe, expect, it } from "vitest";
import { checkFidelity } from "../../open-sse/services/compression/fidelityGate.js";

const numeric = (input, output) => checkFidelity(input, output);

describe("OmniRoute #20107 - compression numeric integrity compares whole numbers", () => {
  it.each([
    ["wait 12 seconds", "wait 123 seconds"],
    ["use 3.5 liters", "use 13.5 liters"],
    ["retry 5 times", "retry 1.5 times"],
  ])("rejects %j rewritten as %j", (input, output) => {
    expect(numeric(input, output)).toMatchObject({ passed: false, failedInvariant: "numeric" });
  });

  it("ignores sentence punctuation and digits glued to words", () => {
    expect(numeric("The limit is 12. Then 1,024, port8080.", "limit 12, then 1,024; port8080")).toEqual({ passed: true });
  });
});
