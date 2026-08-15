import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const request = (reasoning_effort) => ({
  model: "gpt-oss-120b",
  messages: [{ role: "user", content: "hi" }],
  reasoning_effort,
});

const translate = (targetFormat, provider, reasoning_effort) => translateRequest(
  FORMATS.OPENAI,
  targetFormat,
  "gpt-oss-120b",
  request(reasoning_effort),
  false,
  null,
  provider,
);

describe("Ollama Cloud reasoning effort", () => {
  it("maps xhigh to Ollama Cloud's documented max effort", () => {
    expect(translate(FORMATS.OLLAMA, "ollama", "xhigh").reasoning_effort).toBe("max");
  });

  it("preserves Ollama Cloud high effort", () => {
    expect(translate(FORMATS.OLLAMA, "ollama", "high").reasoning_effort).toBe("high");
  });

  it("preserves xhigh for other OpenAI providers", () => {
    expect(translate(FORMATS.OPENAI, "openai", "xhigh").reasoning_effort).toBe("xhigh");
  });
});
