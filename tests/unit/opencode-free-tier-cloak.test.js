import { describe, expect, it } from "vitest";

import { OpenCodeExecutor, OPENCODE_SESSION_RE, OPENCODE_UA } from "../../open-sse/executors/opencode.js";
import { OPENCODE_FINGERPRINT_TOOLS } from "../../open-sse/utils/opencodeFingerprint.js";

// Upstream 5bdcd5e7 + 483c10f5: OpenCode v2 wants its own `read` and `shell`
// definitions verbatim on every free-tier request.
const chatNames = (body) => body.tools.map((tool) => tool.function.name);
const flatNames = (body) => body.tools.map((tool) => tool.name);
const responsesInput = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];

describe("OpenCodeExecutor free-tier fingerprint tools (5bdcd5e7, 483c10f5)", () => {
  it("appends read and shell to Responses requests that already carry caller tools", () => {
    const executor = new OpenCodeExecutor();
    const body = {
      input: responsesInput,
      tools: [{ type: "function", name: "zcode_search", description: "client-provided tool", parameters: { type: "object", properties: {} } }],
      tool_choice: "auto",
    };

    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free", body, true, {});

    expect(flatNames(transformed)).toEqual(["zcode_search", "read", "shell"]);
    expect(transformed.store).toBe(false);
  });

  it("appends read and shell to Chat Completions requests that already carry caller tools", () => {
    const executor = new OpenCodeExecutor();
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "custom_tool", parameters: { type: "object", properties: {} } } }],
    };

    const transformed = executor.transformRequest("big-pickle", body, true, {});

    expect(chatNames(transformed)).toEqual(["custom_tool", "read", "shell"]);
  });

  it("keeps a caller TitleCase Read next to the exact lowercase fingerprint tool", () => {
    const executor = new OpenCodeExecutor();
    const chat = executor.transformRequest("big-pickle", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "Read", parameters: { type: "object", properties: {} } } }],
    }, true, {});
    expect(chatNames(chat)).toEqual(["Read", "read", "shell"]);
    expect(chat._toolNameMap).toBeUndefined();

    const claude = executor.transformRequest("union-alpha", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "Read", description: "d", input_schema: { type: "object", properties: {} } }],
    }, true, {});
    expect(flatNames(claude)).toEqual(["Read", "read", "shell"]);
    expect(claude.tools[1].input_schema.required).toEqual(["path"]);
    expect(claude.tools[1].function).toBeUndefined();
  });

  it("does not throw when a caller tool name is a non-string (#4146 extended)", () => {
    const executor = new OpenCodeExecutor();
    expect(() => executor.transformRequest("big-pickle", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: 1, parameters: { type: "object", properties: {} } } }],
    }, true, {})).not.toThrow();
    expect(() => executor.transformRequest("muse-spark-1.3-contributor-free", {
      input: responsesInput,
      tools: [{ type: "function", name: true, description: "d", parameters: { type: "object", properties: {} } }],
      tool_choice: "auto",
    }, true, {})).not.toThrow();
    expect(() => executor.transformRequest("union-alpha", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: {}, description: "d", input_schema: { type: "object", properties: {} } }],
    }, true, {})).not.toThrow();
  });

  it("injects the fingerprint set without defaulting tool_choice to none when no tools are supplied", () => {
    const executor = new OpenCodeExecutor();
    const transformed = executor.transformRequest("big-pickle", { messages: [] }, true, {});
    expect(chatNames(transformed)).toEqual(OPENCODE_FINGERPRINT_TOOLS);
    // Upstream answers tool_choice "none" with 403 FreeTierError.
    expect(transformed.tool_choice).toBeUndefined();
  });

  it("does not override a caller-supplied tool_choice on Responses requests that already carry tools (#4146)", () => {
    const executor = new OpenCodeExecutor();
    const body = {
      input: responsesInput,
      tools: [{ type: "function", name: "zcode_search", description: "d", parameters: { type: "object", properties: {} } }],
      tool_choice: "required",
    };

    // Not a Muse Spark contributor model: 1.2 and 1.3 carry the hard-400 quirk
    // that demotes any non-auto tool_choice (see the test below).
    const transformed = executor.transformRequest("muse-spark-2.0-contributor-free", body, true, {});

    expect(transformed.tool_choice).toBe("required");
    expect(flatNames(transformed)).toEqual(["zcode_search", "read", "shell"]);
  });

  it("demotes a caller-supplied tool_choice to auto on muse-spark-1.3-contributor-free even with caller tools (aa14ef7)", () => {
    const executor = new OpenCodeExecutor();
    const body = {
      input: responsesInput,
      tools: [{ type: "function", name: "zcode_search", description: "d", parameters: { type: "object", properties: {} } }],
      tool_choice: "required",
    };

    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free", body, true, {});

    expect(transformed.tool_choice).toBe("auto");
    expect(flatNames(transformed)).toEqual(["zcode_search", "read", "shell"]);
  });

  it("still defaults tool_choice to auto on Responses requests with no caller tools (#4146)", () => {
    const executor = new OpenCodeExecutor();
    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free", { input: responsesInput }, true, {});
    expect(transformed.tool_choice).toBe("auto");
  });

  it("ignores a malformed tool entry instead of throwing (#4146)", () => {
    const executor = new OpenCodeExecutor();
    expect(() => executor.transformRequest("muse-spark-1.3-contributor-free", {
      input: responsesInput,
      tools: [null, { type: "function", name: "zcode_search", parameters: { type: "object", properties: {} } }],
    }, true, {})).not.toThrow();
    expect(() => executor.transformRequest("big-pickle", {
      messages: [{ role: "user", content: "hi" }],
      tools: [undefined, { type: "function", function: { name: "custom_tool" } }],
    }, true, {})).not.toThrow();
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

describe("OpenCodeExecutor free-tier client identity (5bdcd5e7)", () => {
  it("advertises the OpenCode v2 User-Agent and cli client", () => {
    const executor = new OpenCodeExecutor();
    const headers = executor.buildHeaders({ id: "noauth", connectionId: "noauth" }, true, null, "big-pickle");
    // Pinned as a literal, independent of the constant: upstream 403s the v1 form.
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.26/cli");
    expect(OPENCODE_UA).toBe("opencode/latest/2.0.26/cli");
    expect(headers["x-opencode-client"]).toBe("cli");
  });

  it("does not forward a v1 or substring-spoofed client UA", () => {
    const executor = new OpenCodeExecutor();
    for (const ua of ["opencode/1.18.31", "not-opencode/latest/2.0.26/cli", "opencode/latest/2.0.26/cli extra", "opencode/latest/1.9.0/cli"]) {
      const headers = executor.buildHeaders(
        { id: "noauth", connectionId: "noauth", rawHeaders: { "user-agent": ua } },
        true, null, "big-pickle"
      );
      expect(headers["User-Agent"]).toBe(OPENCODE_UA);
    }
  });

  it("still forwards a genuine v2 opencode client UA unchanged", () => {
    const executor = new OpenCodeExecutor();
    const headers = executor.buildHeaders(
      { id: "noauth", connectionId: "noauth", rawHeaders: { "user-agent": "opencode/beta/2.1.0/desktop" } },
      true, null, "big-pickle"
    );
    expect(headers["User-Agent"]).toBe("opencode/beta/2.1.0/desktop");
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
