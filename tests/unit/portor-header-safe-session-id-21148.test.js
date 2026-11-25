import { describe, expect, it } from "vitest";
import { extractClientSessionId, resolveSessionId } from "../../open-sse/utils/sessionManager.js";

const headerSafe = (value) => () => new Headers({ session_id: value });

describe("port(omniroute) #21148 357240d3a85a: client session ids are header-safe", () => {
  it.each([
    ["body session_id", {}, { session_id: "会话-一二三" }],
    ["prompt_cache_key", {}, { prompt_cache_key: "session-🚀-1" }],
    ["Claude metadata.user_id", {}, { metadata: { user_id: JSON.stringify({ session_id: "会话" }) } }],
    ["agent id suffix", { "x-session-id": "conv-1" }, { metadata: { agent_id: "代理" } }],
  ])("hashes a non-Latin-1 id from %s into one stable value", (_name, headers, body) => {
    const first = resolveSessionId({ headers, body, scope: "codex" });
    expect(headerSafe(first)).not.toThrow();
    expect(resolveSessionId({ headers, body, scope: "codex" })).toBe(first);
  });

  it("keeps different ids apart, including lone surrogates", () => {
    const id = (value) => extractClientSessionId({}, { session_id: value });
    expect(id("会话-a")).not.toBe(id("会话-b"));
    expect(id("conv-\ud800")).not.toBe(id("conv-\udc00"));
  });

  it("passes Latin-1 ids through and rejects embedded control characters", () => {
    expect(extractClientSessionId({}, { session_id: "conv-abc_123" })).toBe("conv-abc_123");
    expect(extractClientSessionId({}, { session_id: "café-1" })).toBe("café-1");
    expect(extractClientSessionId({}, { session_id: "a\nb" })).toBeNull();
  });
});
