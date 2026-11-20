import { expect, it } from "vitest";
import { buildStreamErrorBytes } from "../../open-sse/utils/streamHelpers.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

it("marks a Claude stream interruption as retryable overload", () => {
  const frame = new TextDecoder().decode(buildStreamErrorBytes(504, "upstream connection lost", FORMATS.CLAUDE));
  expect(frame).toContain('"type":"overloaded_error"');
  expect(frame).toContain("upstream connection lost");
});
