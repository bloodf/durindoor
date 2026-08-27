import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToOllamaRequest } from "../../open-sse/translator/request/openai-to-ollama.js";

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
  it("clamps GPT-OSS xhigh to Ollama's supported high effort", () => {
    expect(translate(FORMATS.OLLAMA, "ollama", "xhigh").think).toBe("high");
  });

  it("emits Ollama Cloud high effort as think", () => {
    const out = translate(FORMATS.OLLAMA, "ollama", "high");
    expect(out.think).toBe("high");
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("forwards a pre-normalized think level during OpenAI translation", () => {
    expect(openaiToOllamaRequest("gpt-oss-120b", {
      messages: [{ role: "user", content: "hi" }],
      think: "high",
    }, false).think).toBe("high");
  });

  it("preserves xhigh for other OpenAI providers", () => {
    expect(translate(FORMATS.OPENAI, "openai", "xhigh").reasoning_effort).toBe("xhigh");
  });
});
