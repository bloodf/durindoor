// Port of decolua/9router 3fd925ab: CodeBuddy chat requests carry the plugin's
// request/conversation ids, else the gateway answers 400 / 11128 "request illegal".
import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("codebuddy-cn channel headers", () => {
  const headers = () => new DefaultExecutor("codebuddy-cn").buildHeaders({ accessToken: "tok" }, true);

  it("sends request/conversation ids, with one shared request id", () => {
    const h = headers();
    expect(h["X-Request-ID"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h["X-Conversation-ID"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h["X-Conversation-Request-ID"]).toBe(h["X-Request-ID"]);
    expect(h["X-Conversation-Message-ID"]).toBe(h["X-Request-ID"]);
    expect(h.Authorization).toBe("Bearer tok");
  });

  it("generates fresh ids per request", () => {
    expect(headers()["X-Request-ID"]).not.toBe(headers()["X-Request-ID"]);
  });
});
