import { expect, it } from "vitest";
import { buildAgentRunFrame } from "../../open-sse/executors/cursor.js";
import { decodeMessage } from "../../open-sse/utils/cursorProtobuf.js";

it("sends a requested model without a Bedrock credentials field", () => {
  const frame = buildAgentRunFrame([{ role: "user", content: "hello" }], "claude-4.6-opus", [], "high");
  const run = decodeMessage(decodeMessage(frame.subarray(5)).get(1)[0].value);
  const model = decodeMessage(run.get(9)[0].value);
  expect(Buffer.from(model.get(1)[0].value).toString()).toBe("claude-4.6-opus");
  expect(model.has(7)).toBe(false);
  const parameter = decodeMessage(model.get(3)[0].value);
  expect(Buffer.from(parameter.get(1)[0].value).toString()).toBe("effort");
  expect(Buffer.from(parameter.get(2)[0].value).toString()).toBe("high");
});
