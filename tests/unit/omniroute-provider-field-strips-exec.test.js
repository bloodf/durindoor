import { describe, it, expect } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

// ---- #6417 (Mistral) + #6418 (NVIDIA): stripUnsupportedParams executor path --
describe("#6417/#6418 stripUnsupportedParams provider strips", () => {
  it("#6417 mistral drops reasoning_content from every message (422 extra_forbidden)", () => {
    const body = {
      model: "mistral-large-latest",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "ok", reasoning_content: "think…" },
        { role: "user", content: "again" },
        { role: "assistant", content: "ok2", reasoning_content: "t2" },
      ],
    };
    stripUnsupportedParams("mistral", body.model, body);
    expect(body.messages[1].reasoning_content).toBeUndefined();
    expect(body.messages[3].reasoning_content).toBeUndefined();
    expect(body.messages[0].content).toBe("hi");
  });

  it("#6418 nvidia z-ai/glm-5.2 drops top-level reasoning + thinking", () => {
    const body = {
      model: "z-ai/glm-5.2",
      reasoning: { effort: "high" },
      thinking: { type: "enabled" },
      temperature: 0.5,
    };
    stripUnsupportedParams("nvidia", body.model, body);
    expect(body.reasoning).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0.5);
  });

  it("#6418 nvidia non-glm model keeps reasoning (rule is model-scoped)", () => {
    const body = { model: "meta/llama-3.1-70b-instruct", reasoning: { effort: "low" } };
    stripUnsupportedParams("nvidia", body.model, body);
    expect(body.reasoning).toEqual({ effort: "low" });
  });
});

// ---- #6411 (OpenCode): drop client_metadata on the way out ------------------
describe("#6411 OpenCodeExecutor strips client_metadata", () => {
  it("transformRequest removes client_metadata and keeps the rest", () => {
    const ex = new OpenCodeExecutor();
    const out = ex.transformRequest("kimi-k2.5", {
      model: "kimi-k2.5",
      client_metadata: { trace_id: "abc", nested: { x: 1 } },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.client_metadata).toBeUndefined();
    expect(out.model).toBe("kimi-k2.5");
    expect(out.messages[0].content).toBe("hi");
  });

  it("transformRequest is a no-op when client_metadata absent", () => {
    const ex = new OpenCodeExecutor();
    const body = { model: "kimi-k2.5", messages: [{ role: "user", content: "hi" }] };
    const out = ex.transformRequest("kimi-k2.5", body);
    expect(out.client_metadata).toBeUndefined();
    expect(out.model).toBe("kimi-k2.5");
  });
});

