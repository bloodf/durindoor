import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

// PR #138 Codex review (Threads 1 + 5): SenseNova Flash-Lite and DeepSeek V4
// Flash both speak OpenAI-style reasoning_effort on the Token Plan endpoint.
describe("OmniRoute #6330 — SenseNova reasoning capabilities", () => {
  it("marks sensenova-6.7-flash-lite reasoning-capable with the openai thinking format (Thread 5)", () => {
    const caps = getCapabilitiesForModel("sensenova", "sensenova-6.7-flash-lite");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
    expect(caps.thinkingCanDisable).toBe(true);
  });

  it("keeps reasoning_effort: none on Flash-Lite instead of stripping it (Thread 5)", () => {
    const body = { model: "sensenova-6.7-flash-lite", messages: [{ role: "user", content: "hi" }], reasoning_effort: "none" };
    const result = applyThinking("openai", "sensenova-6.7-flash-lite", body, "sensenova");
    expect(result.reasoning_effort).toBe("none");
  });

  it("maps deepseek-v4-flash reasoning as openai reasoning_effort, not the native deepseek format (Thread 1)", () => {
    const caps = getCapabilitiesForModel("sensenova", "deepseek-v4-flash");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
  });

  it("passes reasoning_effort: none through for SenseNova DeepSeek instead of converting to thinking:disabled (Thread 1)", () => {
    const body = { model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }], reasoning_effort: "none" };
    const result = applyThinking("openai", "deepseek-v4-flash", body, "sensenova");
    // OpenAI-style passthrough keeps reasoning_effort; the native-deepseek mapper
    // would have replaced it with a thinking:{type:"disabled"} shape.
    expect(result.reasoning_effort).toBe("none");
    expect(result.thinking).toBeUndefined();
  });
});

// PR #138 Codex review (Thread 3): non-streaming SenseNova completions return
// thinking as message.reasoning; the registry normalizeResponse hook must map it
// to message.reasoning_content so translation/logging don't drop it.
describe("OmniRoute #6330 — SenseNova non-stream reasoning normalizer (Thread 3)", () => {
  it("maps choices[].message.reasoning -> message.reasoning_content in place", () => {
    const normalize = PROVIDERS["sensenova"]?.normalizeResponse;
    expect(typeof normalize).toBe("function");
    const body = {
      choices: [{ index: 0, message: { role: "assistant", content: "answer", reasoning: "why" } }],
    };
    const changed = normalize(body);
    expect(changed).toBe(true);
    expect(body.choices[0].message.reasoning_content).toBe("why");
  });

  it("does not overwrite an existing reasoning_content", () => {
    const normalize = PROVIDERS["sensenova"].normalizeResponse;
    const body = {
      choices: [{ index: 0, message: { role: "assistant", content: "a", reasoning: "new", reasoning_content: "kept" } }],
    };
    normalize(body);
    expect(body.choices[0].message.reasoning_content).toBe("kept");
  });
});
