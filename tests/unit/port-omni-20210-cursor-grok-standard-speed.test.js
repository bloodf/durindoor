import { describe, expect, it } from "vitest";
import { decodeMessage } from "../../open-sse/utils/cursorProtobuf.js";
import { buildAgentRunFrame } from "../../open-sse/executors/cursor.js";

const text = (field) => Buffer.from(field[0].value).toString();

function encoded(model, effort = null, catalogIds = null) {
  const frame = buildAgentRunFrame([{ role: "user", content: "hi" }], model, [], effort, catalogIds);
  const run = decodeMessage(decodeMessage(frame.subarray(5)).get(1)[0].value);
  const requested = decodeMessage(run.get(9)[0].value);
  const parameters = (requested.get(3) || []).map((entry) => {
    const pair = decodeMessage(entry.value);
    return [text(pair.get(1)), text(pair.get(2))];
  });
  return { model: text(requested.get(1)), parameters, legacy: run.has(3) };
}

describe("OmniRoute #20210: Cursor Grok 4.7 effort aliases keep standard speed", () => {
  it.each([
    ["grok-4.7-low", "grok-4.7", "low"],
    ["grok-4.7-high", "grok-4.7", "high"],
    ["cu/cursor-grok-4.7-xhigh", "cursor-grok-4.7", "xhigh"],
  ])("sends %s with an explicit standard tier and no legacy envelope", (input, model, effort) => {
    expect(encoded(input)).toEqual({ model, parameters: [["reasoning_effort", effort], ["fast", "false"]], legacy: false });
  });

  it("leaves a -fast id whole", () => {
    expect(encoded("grok-4.7-high-fast")).toEqual({ model: "grok-4.7-high-fast", parameters: [], legacy: true });
  });

  it("leaves a catalog-listed alias verbatim", () => {
    expect(encoded("grok-4.7-high", null, new Set(["grok-4.7-high"]))).toEqual({ model: "grok-4.7-high", parameters: [], legacy: true });
  });

  it("leaves other Grok versions unchanged", () => {
    expect(encoded("grok-4.6-high")).toEqual({ model: "grok-4.6", parameters: [["effort", "high"]], legacy: true });
  });
});
