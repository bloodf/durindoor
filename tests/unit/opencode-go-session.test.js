import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { resolveSessionId } from "../../open-sse/utils/sessionManager.js";

const body = { messages: [{ role: "user", content: "hello" }] };
const transport = {
  format: "openai-responses",
  baseUrl: "https://opencode.ai/zen/go/v1/responses",
};

const TRANSPORTS = [
  { format: "openai", baseUrl: "https://opencode.ai/zen/go/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  { format: "claude", baseUrl: "https://opencode.ai/zen/go/v1/messages", auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true } },
  { format: "openai-responses", baseUrl: "https://opencode.ai/zen/go/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
];

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

function makeCredentials(overrides = {}) {
  return {
    apiKey: "test-key",
    connectionId: "connection-a",
    rawHeaders: {},
    runtimeTransport: TRANSPORTS[0],
    ...overrides,
  };
}

function prepare(executor, overrides = {}) {
  const credentials = overrides.credentials || makeCredentials();
  const prepared = executor.prepareRequestCredentials({
    body: overrides.body || { messages: [{ role: "user", content: "hello" }] },
    credentials,
    providerSessionId: overrides.providerSessionId ?? "conversation-a",
    clientTool: overrides.clientTool ?? "claude",
  });
  return { credentials, prepared };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
});

describe("OpenCode Go session header (DefaultExecutor derivation)", () => {
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

describe("OpenCode Go x-opencode-session (dedicated executor, upstream #3800)", () => {
  it("uses a dedicated executor with request-local session credentials", () => {
    const executor = getExecutor("opencode-go");
    const { credentials, prepared } = prepare(executor);

    expect(executor.constructor.name).toBe("OpenCodeGoExecutor");
    expect(prepared).not.toBe(credentials);
    expect(prepared._openCodeGoAgentSession).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(credentials).not.toHaveProperty("_openCodeGoAgentSession");
    expect(executor).not.toHaveProperty("_currentSessionId");
    expect(executor).not.toHaveProperty("_openCodeGoAgentSession");
  });

  // Fork policy (port #3780) deliberately deviates from upstream #3800 here:
  // upstream preserves a valid caller-provided native session header; the fork
  // NEVER honors inbound x-opencode-session and always translates from
  // fork-resolved session identity.
  it("never honors a caller-supplied native session header", () => {
    const executor = getExecutor("opencode-go");
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "X-OpenCode-Session": " native-session-a " } }),
    });

    expect(prepared._openCodeGoAgentSession).not.toBe("native-session-a");
    expect(prepared._openCodeGoAgentSession).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it("ignores an oversized native session and uses the translated identity", () => {
    const executor = getExecutor("opencode-go");
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "x-opencode-session": "x".repeat(257) } }),
    });

    expect(prepared._openCodeGoAgentSession).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it("keeps the same translated conversation stable across all transports", () => {
    const executor = getExecutor("opencode-go");
    const values = TRANSPORTS.map((runtimeTransport) => {
      const { prepared } = prepare(executor, {
        credentials: makeCredentials({ runtimeTransport }),
      });
      return executor.buildHeaders(prepared, true)["x-opencode-session"];
    });

    expect(new Set(values).size).toBe(1);
    expect(values[0]).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(values[0]).not.toContain("conversation-a");
  });

  it("isolates different conversations", () => {
    const executor = getExecutor("opencode-go");
    const a = prepare(executor, { providerSessionId: "conversation-a" }).prepared._openCodeGoAgentSession;
    const b = prepare(executor, { providerSessionId: "conversation-b" }).prepared._openCodeGoAgentSession;

    expect(a).not.toBe(b);
  });

  it("isolates different downstream agents that reuse the same raw id", () => {
    const executor = getExecutor("opencode-go");
    const claude = prepare(executor, { clientTool: "claude" }).prepared._openCodeGoAgentSession;
    const codex = prepare(executor, { clientTool: "codex" }).prepared._openCodeGoAgentSession;

    expect(claude).not.toBe(codex);
  });

  it("uses a stable opaque connection fallback when no session is supplied", () => {
    const executor = getExecutor("opencode-go");
    const options = {
      credentials: makeCredentials({ connectionId: "fallback-connection" }),
      providerSessionId: null,
      clientTool: null,
      body: { messages: [{ role: "user", content: "headerless" }] },
    };
    const first = prepare(executor, options).prepared._openCodeGoAgentSession;
    const second = prepare(executor, options).prepared._openCodeGoAgentSession;

    expect(first).toBe(second);
    expect(first).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(first).not.toContain("fallback-connection");
  });

  it("adds the prepared session to the actual fetch headers", async () => {
    const executor = getExecutor("opencode-go");
    const credentials = makeCredentials();
    const result = await executor.execute({
      model: "glm-5.2",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: false,
      credentials,
      providerSessionId: "conversation-fetch",
      clientTool: "codex",
    });

    expect(result.headers["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["x-opencode-session"]).toBe(result.headers["x-opencode-session"]);
    expect(credentials).not.toHaveProperty("_openCodeGoAgentSession");
  });

  it("does not add the header to unrelated default executors", () => {
    const headers = new DefaultExecutor("openai").buildHeaders({ apiKey: "test-key" }, false);
    expect(headers["x-opencode-session"]).toBeUndefined();
  });
});

describe("chatCore provider session forwarding", () => {
  it("passes the original provider session and client tool to executor.execute", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../open-sse/handlers/chatCore.js", import.meta.url)),
      "utf8",
    );
    // The fork routes initial, token-refresh, and error retries through a
    // single executeProvider() wrapper, so one call site covers every attempt
    // (upstream has two inline executor.execute call sites instead).
    const calls = [...source.matchAll(/executor\.execute\(\{([\s\S]*?)\}\)/g)].map((match) => match[1]);

    expect(calls).toHaveLength(1);
    for (const call of calls) {
      expect(call).toMatch(/providerSessionId:\s*sessionSeed/);
      expect(call).toMatch(/\bclientTool\b/);
    }
  });
});
