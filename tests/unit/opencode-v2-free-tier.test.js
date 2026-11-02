import { describe, expect, it } from "vitest";

import { OpenCodeExecutor, OPENCODE_SESSION_RE } from "../../open-sse/executors/opencode.js";
import { applyEnvFingerprint, applyFingerprintTools } from "../../open-sse/utils/opencodeFingerprint.js";

// Upstream decolua/9router 5bdcd5e7 (+ ef4679df, 483c10f5): OpenCode v2 moved
// the free tier to /inference/v1 with a new client fingerprint.

const noauth = { id: "noauth", connectionId: "noauth" };

// ~(timeMs * 0x1000 + counter) low 48 bits; the low 12 bits carry ~counter.
const sessionCounter = (session) => (~parseInt(session.slice(4, 16), 16) & 0xfff);

describe("OpenCode v2 free-tier endpoint and headers (5bdcd5e7)", () => {
  it("routes every wire format to /inference/v1", () => {
    const executor = new OpenCodeExecutor();
    expect(executor.buildUrl("big-pickle")).toBe("https://opencode.ai/inference/v1/chat/completions");
    expect(executor.buildUrl("muse-spark-1.3-contributor-free")).toBe("https://opencode.ai/inference/v1/responses");
    expect(executor.buildUrl("union-alpha")).toBe("https://opencode.ai/inference/v1/messages");
  });

  it("sends the session under all four v2 names and never x-opencode-request", () => {
    const executor = new OpenCodeExecutor();
    const credentials = executor.prepareRequestCredentials({
      credentials: { ...noauth, rawHeaders: { "x-opencode-request": "msg_0123456789abABCDEFGHIJKLMN" } },
    });
    const headers = executor.buildHeaders(credentials, true, null, "big-pickle");
    const session = headers["x-opencode-session"];
    expect(session).toMatch(OPENCODE_SESSION_RE);
    expect(headers["x-opencode-session-id"]).toBe(session);
    expect(headers["x-session-affinity"]).toBe(session);
    expect(headers["x-session-id"]).toBe(session);
    expect(headers).not.toHaveProperty("x-opencode-request");
    expect(credentials).not.toHaveProperty("_opencodeRequest");
  });
});

describe("OpenCode v2 session ids (ef4679df, 5bdcd5e7)", () => {
  it("encodes a small counter in the inverted timestamp prefix of translated sessions", () => {
    const executor = new OpenCodeExecutor();
    for (const seed of ["conversation-1", "conversation-2", "x".repeat(200)]) {
      const { _opencodeSession: session } = executor.prepareRequestCredentials({ providerSessionId: seed, clientTool: "claude" });
      expect(session).toMatch(OPENCODE_SESSION_RE);
      expect(sessionCounter(session)).toBe(1);
    }
  });

  it("keeps translated sessions deterministic per identity", () => {
    const executor = new OpenCodeExecutor();
    const args = { credentials: { connectionId: "conn-a" }, providerSessionId: "conversation-1", clientTool: "claude" };
    expect(executor.prepareRequestCredentials(args)._opencodeSession)
      .toBe(executor.prepareRequestCredentials(args)._opencodeSession);
  });

  it("uses a small counter for the standalone fallback session too", () => {
    const executor = new OpenCodeExecutor();
    const session = executor.buildHeaders(noauth, true, null, "big-pickle")["x-opencode-session"];
    expect(session).toMatch(OPENCODE_SESSION_RE);
    expect(sessionCounter(session)).toBe(1);
  });
});

describe("OpenCode v2 fingerprint tools (5bdcd5e7, 483c10f5)", () => {
  it("appends OpenCode's verbatim read and shell definitions and notes them as placeholders", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const map = applyFingerprintTools(body, "chat");

    expect(map.size).toBe(0);
    const [read, shell] = body.tools.map((tool) => tool.function);
    expect(read.name).toBe("read");
    expect(read.parameters.required).toEqual(["path"]);
    expect(read.description).toMatch(/^Read the contents of a file or directory\./);
    expect(shell.name).toBe("shell");
    expect(shell.parameters.required).toEqual(["command"]);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toMatch(
      /^Do not call the `read` or `shell` tools; they are placeholders that do nothing\. Use the other tools you have been given instead\.\n\n.*<env>/s
    );
    expect(body.tool_choice).toBeUndefined();
  });

  it("normalizes a colliding caller tool in place when its parameters fit OpenCode's", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "shell", description: "Commands run on Windows using pwsh.", parameters: { type: "object", properties: { command: { type: "string" }, timeout: { type: "integer" } }, required: ["command"] } } }],
    };
    const map = applyFingerprintTools(body, "chat");

    expect(map.size).toBe(0);
    expect(body.tools.map((tool) => tool.function.name)).toEqual(["shell", "read"]);
    expect(body.tools[0].function.description).toMatch(/Commands run on Linux using bash\./);
    expect(Object.keys(body.tools[0].function.parameters.properties)).toEqual(["command", "workdir", "timeout", "background"]);
    expect(body.messages[0].content).toMatch(/^Do not call the `read` tool;/);
  });

  it("aliases a colliding caller tool with a different schema and retargets tool_choice and history", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c1", content: "ok" },
      ],
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: { file: { type: "string" } } } } }],
      tool_choice: { type: "function", function: { name: "read" } },
    };
    const map = applyFingerprintTools(body, "chat");

    expect([...map]).toEqual([["read_client", "read"]]);
    expect(body.tools.map((tool) => tool.function.name)).toEqual(["read_client", "read", "shell"]);
    expect(body.tool_choice.function.name).toBe("read_client");
    expect(body.messages.find((msg) => msg.tool_calls).tool_calls[0].function.name).toBe("read_client");
  });

  it("aliases Responses history and Claude tool_use history the same way", () => {
    const responses = {
      input: [{ type: "function_call", call_id: "c1", name: "shell", arguments: "{}" }],
      tools: [{ type: "function", name: "shell", parameters: { type: "object", properties: { cmd: { type: "string" } } } }],
    };
    expect([...applyFingerprintTools(responses, "responses")]).toEqual([["shell_client", "shell"]]);
    expect(responses.input[0].name).toBe("shell_client");
    expect(responses.tool_choice).toBe("auto");
    expect(responses.instructions).toMatch(/^Do not call the `read` or `shell` tools;/);
    expect(responses.tools.map((tool) => tool.name)).toEqual(["shell_client", "read", "shell"]);
    expect(responses.tools[1]).toMatchObject({ type: "function", name: "read", strict: false });

    const claude = {
      system: [{ type: "text", text: "sys" }],
      messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "shell", input: {} }] }],
      tools: [{ name: "shell", input_schema: { type: "object", properties: { cmd: { type: "string" } } } }],
    };
    applyFingerprintTools(claude, "claude");
    expect(claude.messages[0].content[0].name).toBe("shell_client");
    expect(claude.tools.map((tool) => tool.name)).toEqual(["shell_client", "read", "shell"]);
    expect(claude.tools[2].input_schema.required).toEqual(["command"]);
    expect(claude.system.at(-1).text).toMatch(/^Do not call the `read` or `shell` tools;/);
  });

  it("hands the alias map to chatCore as non-enumerable request metadata", () => {
    const executor = new OpenCodeExecutor();
    const transformed = executor.transformRequest("big-pickle", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: { file: { type: "string" } } } } }],
    }, true, {});

    expect(transformed._toolNameMap).toEqual(new Map([["read_client", "read"]]));
    expect(Object.keys(transformed)).not.toContain("_toolNameMap");
    expect(JSON.stringify(transformed)).not.toContain("_toolNameMap");
  });
});

describe("OpenCode Free reasoning_content placeholder (upstream e964e482)", () => {
  const history = () => ({
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "again" },
    ],
  });

  it("injects a placeholder on assistant turns of Chat Completions history", () => {
    const transformed = new OpenCodeExecutor().transformRequest("big-pickle", history(), true, {});
    expect(transformed.messages.find((msg) => msg.role === "assistant").reasoning_content).toBe(" ");
  });

  it("never adds reasoning_content to Claude Messages bodies (Union Alpha)", () => {
    const transformed = new OpenCodeExecutor().transformRequest("union-alpha", history(), true, {});
    expect(transformed.messages.find((msg) => msg.role === "assistant")).not.toHaveProperty("reasoning_content");
  });

  it("keeps the tool rename map when transformRequest re-runs on the same body (retry)", () => {
    const executor = new OpenCodeExecutor();
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: { file: { type: "string" } } } } }],
    };
    const first = executor.transformRequest("big-pickle", body, true, {});
    expect([...first._toolNameMap]).toEqual([["read_client", "read"]]);
    const second = executor.transformRequest("big-pickle", body, true, {});
    expect([...second._toolNameMap]).toEqual([["read_client", "read"]]);
    const third = executor.transformRequest("big-pickle", first, true, {});
    expect([...third._toolNameMap]).toEqual([["read_client", "read"]]);
  });
});

// Upstream ce060c79: without the CLI's <env> block in the system prompt the
// free tier answers 429 FreeUsageLimitError, even with the tools declared.
describe("OpenCode <env> system-prompt marker (ce060c79)", () => {
  it("appends the marker to a chat system message without replacing it", () => {
    const body = { messages: [{ role: "system", content: "You are helpful." }, { role: "user", content: "hi" }] };
    expect(applyEnvFingerprint(body, "chat")).toBe(true);
    expect(body.messages[0].content).toMatch(/^You are helpful\.\n\nHere is some useful information about the environment/);
    expect(body.messages[0].content).toContain("<env>\n  Working directory: /workspace");
    expect(body.messages[0].content).toContain(`  Platform: ${process.platform}`);
    expect(body.messages[0].content).toMatch(/<\/env>$/);
    expect(body.messages).toHaveLength(2);
  });

  it("adds a system message when the chat body has none", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    expect(applyEnvFingerprint(body, "chat")).toBe(true);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("<env>");
  });

  it("is idempotent once the marker is present", () => {
    const body = { messages: [{ role: "system", content: "x\n\n<env>\n</env>" }] };
    expect(applyEnvFingerprint(body, "chat")).toBe(false);
    expect(body.messages[0].content).toBe("x\n\n<env>\n</env>");

    const once = { instructions: "Be terse." };
    applyEnvFingerprint(once, "responses");
    const after = once.instructions;
    expect(applyEnvFingerprint(once, "responses")).toBe(false);
    expect(once.instructions).toBe(after);
  });

  it("covers Responses instructions and Claude system strings and text blocks", () => {
    const responses = { instructions: "Be terse." };
    expect(applyEnvFingerprint(responses, "responses")).toBe(true);
    expect(responses.instructions).toMatch(/^Be terse\.\n\n.*<env>/s);

    const claudeString = { system: "Be terse.", messages: [{ role: "user", content: "hi" }] };
    expect(applyEnvFingerprint(claudeString, "claude")).toBe(true);
    expect(claudeString.system).toMatch(/^Be terse\.\n\n.*<env>/s);
    expect(claudeString.messages).toHaveLength(1);

    const claudeBlocks = { system: [{ type: "text", text: "Be terse.", cache_control: { type: "ephemeral" } }], messages: [] };
    expect(applyEnvFingerprint(claudeBlocks, "claude")).toBe(true);
    expect(claudeBlocks.system).toHaveLength(1);
    expect(claudeBlocks.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(claudeBlocks.system[0].text).toMatch(/^Be terse\.\n\n.*<env>/s);

    const claudeUnset = { messages: [] };
    expect(applyEnvFingerprint(claudeUnset, "claude")).toBe(true);
    expect(claudeUnset.system).toMatch(/^Here is some useful information/);
  });

  it("does not leak the gateway's working directory", () => {
    const body = { messages: [] };
    applyEnvFingerprint(body, "chat");
    expect(body.messages[0].content).not.toContain(process.cwd());
  });

  it("runs on every free-lane wire format in transformRequest", () => {
    const executor = new OpenCodeExecutor();
    const chat = executor.transformRequest("big-pickle", { messages: [{ role: "user", content: "hi" }] }, true, {});
    expect(chat.messages.find((msg) => msg.role === "system").content).toContain("<env>");
    const claude = executor.transformRequest("union-alpha", { messages: [{ role: "user", content: "hi" }] }, true, {});
    expect(JSON.stringify(claude.system)).toContain("<env>");
    const muse = executor.transformRequest("muse-spark-1.3-contributor-free", { input: "hi" }, true, {});
    expect(muse.instructions).toContain("<env>");
  });
});
