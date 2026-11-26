import { describe, it, expect } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";

const credentials = { apiKey: "synthetic", connectionId: "conn-1" };
const turn = (...texts) => ({ messages: texts.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content })) });
const headersFor = (provider, sessionId, body, creds = credentials) =>
  getExecutor(provider).buildHeaders(creds, true, { clientHeaders: sessionId ? { "x-session-id": sessionId } : {} }, "glm-5.2", body);

describe("OmniRoute #20228: CodeBuddy conversation headers", () => {
  it.each(["codebuddy-cn", "codebuddy-intl"])("%s keeps one conversation id with new request and message ids per turn", (provider) => {
    const first = headersFor(provider, "session-a", turn("hi"));
    const second = headersFor(provider, "session-a", turn("hi", "hello", "again"));
    expect(first["X-Conversation-ID"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second["X-Conversation-ID"]).toBe(first["X-Conversation-ID"]);
    expect(second["X-Conversation-Request-ID"]).not.toBe(first["X-Conversation-Request-ID"]);
    expect(second["X-Conversation-Message-ID"]).not.toBe(first["X-Conversation-Message-ID"]);
    // The channel check's one-id-per-request shape is unchanged.
    expect(first["X-Conversation-Message-ID"]).toBe(first["X-Request-ID"]);
  });

  it("reads a body session field and scopes the id to the account", () => {
    const body = { ...turn("hi"), prompt_cache_key: "cache-1" };
    const id = headersFor("codebuddy-cn", null, body)["X-Conversation-ID"];
    expect(headersFor("codebuddy-cn", null, body)["X-Conversation-ID"]).toBe(id);
    expect(headersFor("codebuddy-cn", null, body, { ...credentials, connectionId: "conn-2" })["X-Conversation-ID"]).not.toBe(id);
  });

  it("does not treat equal message text as one conversation", () => {
    expect(headersFor("codebuddy-cn", null, turn("hi"))["X-Conversation-ID"])
      .not.toBe(headersFor("codebuddy-cn", null, turn("hi"))["X-Conversation-ID"]);
  });
});
