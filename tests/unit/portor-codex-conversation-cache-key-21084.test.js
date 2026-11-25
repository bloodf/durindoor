import { beforeEach, describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { clearSessionStore, resolveSessionId } from "../../open-sse/utils/sessionManager.js";

const connectionId = "conn-1";
const workspaceId = "ws-account-wide";
const codexKey = (body, options = {}) => resolveSessionId({ body, connectionId, scope: "codex", ...options });
const user = (content) => ({ role: "user", content });
const reply = { role: "assistant", content: "a long assistant reply ".repeat(5) };

describe("OmniRoute #21084 — per-conversation Codex prompt cache key", () => {
  beforeEach(() => clearSessionStore());

  it("separates first turns that share a system prompt and a connection", () => {
    const body = (text) => ({ instructions: "shared system", input: [user(text)] });

    expect(codexKey(body("first task"), { workspaceId })).not.toBe(codexKey(body("second task"), { workspaceId }));
    expect(codexKey(body("first task"), { workspaceId })).not.toBe(workspaceId);
  });

  it("keeps the key across follow-up turns, in string and part form", () => {
    const first = codexKey({ input: "first task" });
    const followUp = codexKey({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "first task" }] },
        reply,
        user("go on"),
      ],
    });

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(followUp).toBe(first);
  });

  it("keys Claude requests on system and first user text, ignoring cache markers", () => {
    const body = (system, text, extra = {}) => ({
      system: [{ type: "text", text: system, ...extra }],
      messages: [user([{ type: "text", text, ...extra }])],
    });
    const first = codexKey(body("system A", "task"));

    expect(codexKey(body("system A", "task", { cache_control: { type: "ephemeral" } }))).toBe(first);
    expect(codexKey(body("system B", "task"))).not.toBe(first);
    expect(codexKey(body("system A", "other task"))).not.toBe(first);
  });

  it("separates long shared prefixes, first-turn images, preambles, models and accounts", () => {
    const prefix = "p".repeat(10_000);
    const image = (url) => ({ input: [user([{ type: "input_text", text: "describe" }, { type: "input_image", image_url: url }])] });
    const withPreamble = (text) => ({ messages: [{ role: "developer", content: text }, user("task")] });

    expect(codexKey({ input: `${prefix}a` })).not.toBe(codexKey({ input: `${prefix}b` }));
    expect(codexKey(image("https://img.test/a.png"))).not.toBe(codexKey(image("https://img.test/b.png")));
    expect(codexKey(withPreamble("rules A"))).not.toBe(codexKey(withPreamble("rules B")));
    expect(codexKey({ model: "gpt-a", input: "task" })).not.toBe(codexKey({ model: "gpt-b", input: "task" }));
    expect(codexKey({ input: "task" })).not.toBe(codexKey({ input: "task" }, { connectionId: "conn-2" }));
  });

  it("keeps client ids first, and the old fallbacks without a user turn", () => {
    expect(codexKey({ prompt_cache_key: "client-key", input: "task" })).toBe("client-key");
    expect(codexKey({ input: "task" }, { headers: { "x-session-id": "header-key" } })).toBe("header-key");
    expect(codexKey({ metadata: { user_id: "user_x_session_aaaa-bbbb" }, messages: [user("task")] })).toBe("claude:aaaa-bbbb");
    expect(codexKey({ instructions: "system only", input: [] }, { workspaceId })).toBe(workspaceId);
  });

  it("leaves other provider scopes unchanged", () => {
    expect(resolveSessionId({ body: { input: "task" }, connectionId, workspaceId, scope: "grok-cli" })).toBe(workspaceId);
  });

  it("sends the conversation key as prompt_cache_key from the executor", () => {
    const executor = new CodexExecutor();
    const send = (text) => executor.transformRequest("gpt-5.3-codex", { input: [user(text)] }, true,
      { connectionId, providerSpecificData: { workspaceId } }).prompt_cache_key;

    expect(send("first task")).toBe(send("first task"));
    expect(send("first task")).not.toBe(send("second task"));
    expect(send("first task")).not.toBe(workspaceId);
  });
});
