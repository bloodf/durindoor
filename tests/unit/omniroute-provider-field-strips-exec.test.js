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

// ---- #6419 (Kimi): reasoning_content injected on assistant turns -----------
describe("#6419 Kimi reasoning_content injection (scope all via registry)", () => {
  it("kimi provider injects reasoning_content placeholder on empty assistant msg", () => {
    const body = {
      model: "kimi-k2.5",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ],
    };
    const out = injectReasoningContent({ provider: "kimi", model: "kimi-k2.5", body });
    expect(out.messages[1].reasoning_content).toBe(" ");
    expect(out.messages[0].reasoning_content).toBeUndefined();
  });

  it("does not overwrite an existing reasoning_content", () => {
    const body = {
      model: "kimi-k2.5",
      messages: [{ role: "assistant", content: "x", reasoning_content: "real" }],
    };
    const out = injectReasoningContent({ provider: "kimi", model: "kimi-k2.5", body });
    expect(out.messages[0].reasoning_content).toBe("real");
  });

  it("kimi-* model rule (toolCalls scope) injects only when tool_calls present", () => {
    const withTools = {
      model: "kimi-k2.5",
      messages: [{ role: "assistant", content: "c", tool_calls: [{ id: "t1" }] }],
    };
    const out = injectReasoningContent({ provider: "other", model: "kimi-k2.5", body: withTools });
    expect(out.messages[0].reasoning_content).toBe(" ");

    const noTools = {
      model: "kimi-k2.5",
      messages: [{ role: "assistant", content: "c" }],
    };
    const out2 = injectReasoningContent({ provider: "other", model: "kimi-k2.5", body: noTools });
    expect(out2.messages[0].reasoning_content).toBeUndefined();
  });
});
