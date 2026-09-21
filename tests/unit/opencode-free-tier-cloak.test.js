import { describe, expect, it } from "vitest";

import { OpenCodeExecutor, OPENCODE_SESSION_RE, OPENCODE_DECOY_RESPONSES_TOOLS, OPENCODE_UA } from "../../open-sse/executors/opencode.js";

// Upstream #4188: the free-tier gate wants all four of the official CLI's
// file-search tools, not just the bash/read pair the fork shipped before.
const OPENCODE_FINGERPRINT_NAMES = ["bash", "glob", "grep", "read"];

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
    for (const decoy of OPENCODE_FINGERPRINT_NAMES) {
      expect(names.filter((n) => n === decoy)).toHaveLength(1);
    }
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
    for (const decoy of OPENCODE_FINGERPRINT_NAMES) {
      expect(names).toContain(decoy);
    }
  });

  it("still injects the full decoy set when no tools are supplied", () => {
    const executor = new OpenCodeExecutor();
    const transformed = executor.transformRequest("big-pickle", { messages: [] }, true, {});
    const names = transformed.tools.map((tool) => tool.function.name);
    expect(names).toEqual(OPENCODE_FINGERPRINT_NAMES);
    expect(transformed.tool_choice).toBe("none");
  });

  it("does not override a caller-supplied tool_choice on Responses requests that already carry tools (#4146)", () => {
    const executor = new OpenCodeExecutor();
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [{ type: "function", name: "zcode_search", description: "d", parameters: { type: "object", properties: {} } }],
      tool_choice: "required",
    };

    // Deliberately not a Muse Spark contributor model: 1.2 and 1.3 both carry
    // the hard-400 quirk (port(upstream): aa14ef7 + #4165) that demotes any
    // non-auto tool_choice regardless of caller tools, which is the opposite of
    // what this test is checking. See the dedicated test below for that quirk.
    const transformed = executor.transformRequest("muse-spark-2.0-contributor-free", body, true, {});

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

describe("OpenCodeExecutor free-tier client identity (#4128)", () => {
  it("advertises the full official-client User-Agent, not a bare version token", () => {
    const executor = new OpenCodeExecutor();
    const headers = executor.buildHeaders({ id: "noauth", connectionId: "noauth" }, true, null, "big-pickle");
    expect(headers["User-Agent"]).toBe(OPENCODE_UA);
    // The gate still has to read a >= 1.17 opencode version out of it.
    expect(headers["User-Agent"]).toMatch(/(^|\s)opencode\/1\.(1[7-9]|[2-9]\d)/);
    // Pin the ai-sdk and runtime tokens as literal strings, independent of the
    // OPENCODE_UA constant: a regression that shrinks the constant back to a
    // bare "opencode/<version>" must not stay green here.
    expect(headers["User-Agent"]).toContain("ai-sdk/provider-utils/4.0.40");
    expect(headers["User-Agent"]).toContain("runtime/bun/1.3.14");
  });

  it("does not forward a client UA that only contains opencode/X.Y as a substring", () => {
    // "not-opencode/1.18.31" and "opencode/1.18.31extra" both contain a
    // digit-for-digit match of the version regex if it isn't token-bounded,
    // but neither is a string Zen's real client ever sends; forwarding it
    // unchanged would ship a fingerprint Zen has never seen instead of
    // falling back to the known-good literal.
    const executor = new OpenCodeExecutor();
    const spoofed = executor.buildHeaders(
      { id: "noauth", connectionId: "noauth", rawHeaders: { "user-agent": "not-opencode/1.18.31" } },
      true, null, "big-pickle"
    );
    expect(spoofed["User-Agent"]).toBe(OPENCODE_UA);

    const trailing = executor.buildHeaders(
      { id: "noauth", connectionId: "noauth", rawHeaders: { "user-agent": "opencode/1.18.31extra" } },
      true, null, "big-pickle"
    );
    expect(trailing["User-Agent"]).toBe(OPENCODE_UA);
  });

  it("still forwards a genuine opencode/X.Y client UA unchanged", () => {
    const executor = new OpenCodeExecutor();
    const headers = executor.buildHeaders(
      { id: "noauth", connectionId: "noauth", rawHeaders: { "user-agent": "opencode/1.17.0" } },
      true, null, "big-pickle"
    );
    expect(headers["User-Agent"]).toBe("opencode/1.17.0");
  });

  it("pins prompt_cache_key to the canonical session on Muse Responses requests", () => {
    const executor = new OpenCodeExecutor();
    const credentials = executor.prepareRequestCredentials({
      credentials: { connectionId: "conn-a" },
      providerSessionId: "conversation-1",
      clientTool: "claude",
    });
    const body = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };

    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free", body, true, credentials);

    expect(transformed.prompt_cache_key).toBe(credentials._opencodeSession);
    expect(transformed.prompt_cache_key).toMatch(OPENCODE_SESSION_RE);
  });

  it("reuses one prompt_cache_key across turns of the same conversation", () => {
    const executor = new OpenCodeExecutor();
    const keyFor = (text) => {
      const args = { credentials: { connectionId: "conn-a" }, providerSessionId: "conversation-1", clientTool: "claude" };
      const credentials = executor.prepareRequestCredentials(args);
      const body = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }] };
      return executor.transformRequest("muse-spark-1.3-contributor-free", body, true, credentials).prompt_cache_key;
    };
    expect(keyFor("turn one")).toBe(keyFor("turn two"));
  });

  it("never overwrites a caller-supplied prompt_cache_key", () => {
    const executor = new OpenCodeExecutor();
    const credentials = executor.prepareRequestCredentials({ credentials: { connectionId: "conn-a" } });
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      prompt_cache_key: "caller-key",
    };

    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free", body, true, credentials);

    expect(transformed.prompt_cache_key).toBe("caller-key");
  });

  it("treats a whitespace-only caller prompt_cache_key as missing and pins the session", () => {
    const executor = new OpenCodeExecutor();
    const credentials = executor.prepareRequestCredentials({ credentials: { connectionId: "conn-a" } });
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      prompt_cache_key: "   ",
    };

    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free", body, true, credentials);

    expect(transformed.prompt_cache_key).toBe(credentials._opencodeSession);
  });

  it("leaves prompt_cache_key alone on the Chat Completions route", () => {
    const executor = new OpenCodeExecutor();
    const credentials = executor.prepareRequestCredentials({ credentials: { connectionId: "conn-a" } });

    const transformed = executor.transformRequest("big-pickle", { messages: [] }, true, credentials);

    expect(transformed.prompt_cache_key).toBeUndefined();
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
