import { describe, expect, it } from "vitest";

import { OpenCodeExecutor, OPENCODE_SESSION_RE } from "../../open-sse/executors/opencode.js";

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

  it("forces stream:true for free-tier dispatch and skips it for compact requests", () => {
    const executor = new OpenCodeExecutor();
    const streamed = executor.transformRequest("big-pickle", { messages: [] }, false, {}, null);
    expect(streamed.stream).toBe(true);

    const compact = executor.transformRequest("big-pickle", { messages: [] }, false, {}, { compact: true });
    expect(compact.stream).toBeUndefined();
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
