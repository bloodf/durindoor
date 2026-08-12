import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const translate = (model, body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, model, body, true, null, "anthropic");

const body = (extra = {}) => ({
  messages: [{ role: "user", content: "hi" }],
  temperature: 0.7,
  ...extra,
});

describe("OpenAI → Claude thinking temperature (#1264)", () => {
  it("preserves temperature for Claude 4 when thinking is not requested", () => {
    expect(translate("claude-opus-4-6", body())).toHaveProperty("temperature", 0.7);
  });

  it("strips temperature after explicit thinking is normalized", () => {
    const result = translate("claude-haiku-4-5-20251001", body({ reasoning_effort: "medium" }));

    expect(result.thinking).toMatchObject({ type: "enabled" });
    expect(result).not.toHaveProperty("temperature");
  });
});
