import { describe, expect, it } from "vitest";

import { OpenCodeExecutor, OPENCODE_SESSION_RE, OPENCODE_DECOY_RESPONSES_TOOLS } from "../../open-sse/executors/opencode.js";

describe("OpenCodeExecutor free-tier decoy tool cloaking (#4155)", () => {
  it("cloaks Responses requests even when the client already supplies tools", () => {
    const executor = new OpenCodeExecutor();
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [{
        type: "function",
        name: "zcode_search",
        description: "client-provided tool",
        parameters: { type: "object", properties: {} },
      }],
      tool_choice: "auto",
    };

    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free", body, true, {});

    const names = transformed.tools.map((tool) => tool.name);
    expect(names).toContain("zcode_search");
    expect(names).toContain("bash");
    expect(names).toContain("read");
    expect(names.filter((n) => n === "bash")).toHaveLength(1);
    expect(names.filter((n) => n === "read")).toHaveLength(1);
    expect(transformed.store).toBe(false);
  });

  it("cloaks Chat Completions requests even when the client already supplies tools", () => {
    const executor = new OpenCodeExecutor();
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "custom_tool", parameters: { type: "object", properties: {} } } }],
    };

    const transformed = executor.transformRequest("big-pickle", body, true, {});

    const names = transformed.tools.map((tool) => tool.function.name);
    expect(names).toContain("custom_tool");
    expect(names).toContain("bash");
    expect(names).toContain("read");
  });

  it("still injects the full decoy set when no tools are supplied", () => {
    const executor = new OpenCodeExecutor();
    const transformed = executor.transformRequest("big-pickle", { messages: [] }, true, {});
    const names = transformed.tools.map((tool) => tool.function.name);
    expect(names).toEqual(["bash", "read"]);
    expect(transformed.tool_choice).toBe("none");
  });

  it("does not override a caller-supplied tool_choice on Responses requests that already carry tools (#4146)", () => {
    const executor = new OpenCodeExecutor();
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [{ type: "function", name: "zcode_search", description: "d", parameters: { type: "object", properties: {} } }],
      tool_choice: "required",
    };

    // Deliberately not muse-spark-1.3-contributor-free: that model has its own
    // hard-400 quirk (port(upstream): aa14ef7) that demotes any non-auto
    // tool_choice regardless of caller tools, which is the opposite of what
    // this test is checking. See the dedicated test below for that model.
    const transformed = executor.transformRequest("muse-spark-1.2-contributor-free", body, true, {});

    expect(transformed.tool_choice).toBe("required");
    const names = transformed.tools.map((tool) => tool.name);
    expect(names).toEqual(["zcode_search", ...OPENCODE_DECOY_RESPONSES_TOOLS.map((t) => t.name)]);
  });

  it("demotes a caller-supplied tool_choice to auto on muse-spark-1.3-contributor-free even with caller tools (aa14ef7 overrides #4146 for this model only)", () => {
    // OpenCode Free returns HTTP 400 for muse-spark-1.3-contributor-free when
    // tool_choice is anything but "auto" — a hard upstream constraint, not a
    // preference. #4146's "don't override the caller" rule exists to avoid
    // gratuitously discarding intent, not to send a request known to fail;
    // the model-specific quirk (forceAutoToolChoiceModels) wins for this one
    // id. Every other muse model keeps #4146's preservation behavior, proven
    // by the test above.
    const executor = new OpenCodeExecutor();
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [{ type: "function", name: "zcode_search", description: "d", parameters: { type: "object", properties: {} } }],
      tool_choice: "required",
    };

    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free", body, true, {});

    expect(transformed.tool_choice).toBe("auto");
    const names = transformed.tools.map((tool) => tool.name);
    expect(names).toEqual(["zcode_search", ...OPENCODE_DECOY_RESPONSES_TOOLS.map((t) => t.name)]);
  });

  it("still defaults tool_choice to auto on Responses requests with no caller tools (#4146)", () => {
    const executor = new OpenCodeExecutor();
    const body = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };

    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free", body, true, {});

    expect(transformed.tool_choice).toBe("auto");
  });

  it("ignores a malformed tool entry instead of throwing (#4146)", () => {
    const executor = new OpenCodeExecutor();
    const responsesBody = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [null, { type: "function", name: "zcode_search", parameters: { type: "object", properties: {} } }],
    };
    expect(() => executor.transformRequest("muse-spark-1.3-contributor-free", responsesBody, true, {})).not.toThrow();

    const chatBody = { messages: [{ role: "user", content: "hi" }], tools: [undefined, { type: "function", function: { name: "custom_tool" } }] };
    expect(() => executor.transformRequest("big-pickle", chatBody, true, {})).not.toThrow();
  });

  it("forces stream:true for free-tier dispatch", () => {
    const executor = new OpenCodeExecutor();
    const streamed = executor.transformRequest("big-pickle", { messages: [] }, false, {}, null);
    expect(streamed.stream).toBe(true);
  });

  // The compact-responses endpoint hardcodes stream:false at the chatCore level
  // (ignores forceStream) — Zen 403s any non-streaming free-tier dispatch, so
  // that combination can never succeed. Fail fast with a clear message instead
  // of silently deleting body.stream and surfacing an opaque upstream 403.
  it("fails fast with a clear message for the incompatible compact-responses endpoint", () => {
    const executor = new OpenCodeExecutor();
    expect(() => executor.transformRequest("big-pickle", { messages: [] }, false, {}, { compact: true }))
      .toThrow(/compact-responses/i);
  });
});

describe("OpenCodeExecutor canonical session identity", () => {
  it("preserves an already-valid native x-opencode-session header", async () => {
    const executor = new OpenCodeExecutor();
    const valid = "ses_0123456789abABCDEFGHIJKLMN";
    const prepared = executor.prepareRequestCredentials({
      credentials: { rawHeaders: { "x-opencode-session": valid } },
    });
    expect(prepared._opencodeSession).toBe(valid);
  });

  it("translates an arbitrary session seed into the canonical shape", () => {
    const executor = new OpenCodeExecutor();
    const prepared = executor.prepareRequestCredentials({
      credentials: { connectionId: "conn-a" },
      providerSessionId: "conversation-1",
      clientTool: "claude",
    });
    expect(prepared._opencodeSession).toMatch(OPENCODE_SESSION_RE);
  });

  it("isolates session identity by client tool", () => {
    const executor = new OpenCodeExecutor();
    const a = executor.prepareRequestCredentials({ providerSessionId: "same", clientTool: "claude" });
    const b = executor.prepareRequestCredentials({ providerSessionId: "same", clientTool: "codex" });
    expect(a._opencodeSession).not.toBe(b._opencodeSession);
  });
});
