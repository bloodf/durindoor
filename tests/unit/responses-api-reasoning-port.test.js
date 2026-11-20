import { expect, it } from "vitest";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";

it("preserves nested Responses reasoning for downstream normalization", () => {
  const result = convertResponsesApiFormat({ input: "Hello", reasoning: { effort: "low" } });
  expect(result.reasoning).toEqual({ effort: "low" });
  expect(result.reasoning_effort).toBeUndefined();
});
