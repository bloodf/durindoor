import crypto from "crypto";
import { describe, expect, it } from "vitest";

import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveSessionId } from "../../open-sse/utils/sessionManager.js";

const body = { messages: [{ role: "user", content: "hello" }] };
const transport = {
  format: "openai-responses",
  baseUrl: "https://opencode.ai/zen/go/v1/responses",
};

function request(rawHeaders) {
  const credentials = {
    apiKey: "test-key",
    connectionId: "connection-a",
    rawHeaders,
    runtimeTransport: transport,
  };
  const executor = new DefaultExecutor("opencode-go");
  executor.transformRequest("muse-spark-1.3-contributor", structuredClone(body), true, credentials);
  return executor.buildHeaders(credentials, true)["x-opencode-session"];
}

function expectedSession(rawHeaders) {
  const sessionId = resolveSessionId({
    headers: rawHeaders,
    body,
    connectionId: "connection-a",
    scope: "opencode-go",
  });
  return `ses_${crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}`;
}

describe("OpenCode Go session header", () => {
  it("derives a stable opaque header from the resolved conversation", () => {
    const headers = { "x-session-id": "conversation-a" };

    expect(request(headers)).toBe(expectedSession(headers));
    expect(request(headers)).toBe(request(headers));
    expect(request({ "x-session-id": "conversation-b" })).not.toBe(request(headers));
  });

  it("does not let inbound x-opencode-session alter the provider header", () => {
    const trustedHeaders = { "x-session-id": "conversation-a" };
    const hostileHeaders = {
      ...trustedHeaders,
      "x-opencode-session": "caller-controlled-session",
      "X-OpenCode-Session": "case-insensitive-attacker-value",
    };

    expect(request(hostileHeaders)).toBe(request(trustedHeaders));
    expect(request(hostileHeaders)).toBe(expectedSession(trustedHeaders));
  });
});
