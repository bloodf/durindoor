import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const persisted = vi.hoisted(() => new Map());

vi.mock("@/lib/db/helpers/kvStore.js", () => ({
  makeKv: () => ({
    get: async (key) => persisted.get(key),
    set: async (key, value) => {
      persisted.set(key, value);
    },
    remove: async (key) => {
      persisted.delete(key);
    },
    getAll: async () => Object.fromEntries(persisted),
  }),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async () => new Response("{}", { status: 200 })),
}));

const {
  clearThoughtSignatureMemory,
  getGeminiThoughtSignatureSync,
} = await import("../../open-sse/services/thoughtSignatureStore.js");
const { openaiToAntigravityRequest } = await import("../../open-sse/translator/request/openai-to-gemini.js");
const { DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } = await import("../../open-sse/config/defaultThinkingSignature.js");
const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

let seq = 0;
const uid = (prefix) => `${prefix}_${Date.now()}_${seq++}`;

function toolHistory(callId) {
  return {
    messages: [
      { role: "user", content: "list files" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: callId, type: "function", function: { name: "ls", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: callId, content: "a.txt" },
    ],
  };
}

function functionCallSignatures(req) {
  return (req.request?.contents || [])
    .flatMap((content) => content.parts || [])
    .filter((part) => part.functionCall)
    .map((part) => part.thoughtSignature);
}

describe("Antigravity persisted Gemini tool signatures (upstream PR #5894)", () => {
  beforeEach(() => {
    persisted.clear();
    clearThoughtSignatureMemory();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a persisted signature before dispatch when RAM is cold without mutating input", async () => {
    const callId = uid("cold");
    const model = "gemini-4-hydrogen";
    persisted.set(`client-session:${callId}`, {
      signature: "PERSISTED_SIGNATURE",
      family: "gemini",
      expiresAt: Date.now() + 60_000,
    });
    const credentials = { _clientSessionId: "client-session", accessToken: "test-token" };
    const body = openaiToAntigravityRequest(model, toolHistory(callId), true, credentials);

    expect(getGeminiThoughtSignatureSync(callId, credentials._clientSessionId, model)).toBeNull();
    expect(functionCallSignatures(body)).toEqual([DEFAULT_THINKING_GEMINI_CLI_SIGNATURE]);

    await new AntigravityExecutor().execute({ model, body, stream: true, credentials });

    const sent = JSON.parse(proxyAwareFetch.mock.lastCall[1].body);
    expect(functionCallSignatures(sent)).toEqual(["PERSISTED_SIGNATURE"]);
    expect(functionCallSignatures(body)).toEqual([DEFAULT_THINKING_GEMINI_CLI_SIGNATURE]);
  });

  it("keeps explicitly supplied non-default signatures intact", async () => {
    const callId = uid("explicit");
    const model = "gemini-4-hydrogen";
    persisted.set(`client-session:${callId}`, {
      signature: "PERSISTED_SIGNATURE",
      family: "gemini",
      expiresAt: Date.now() + 60_000,
    });
    const credentials = { _clientSessionId: "client-session", accessToken: "test-token" };
    const body = openaiToAntigravityRequest(model, toolHistory(callId), true, credentials);
    const fnPart = body.request.contents.flatMap((c) => c.parts).find((p) => p.functionCall);
    fnPart.thoughtSignature = "CLIENT_EXPLICIT_SIGNATURE";

    await new AntigravityExecutor().execute({ model, body, stream: true, credentials });

    const sent = JSON.parse(proxyAwareFetch.mock.lastCall[1].body);
    expect(functionCallSignatures(sent)).toEqual(["CLIENT_EXPLICIT_SIGNATURE"]);
  });

  it("respects the model family check when restoring persisted signatures", async () => {
    const callId = uid("cross_family");
    const model = "gemini-4-hydrogen";
    persisted.set(`client-session:${callId}`, {
      signature: "CLAUDE_ONLY_SIGNATURE",
      family: "claude",
      expiresAt: Date.now() + 60_000,
    });
    const credentials = { _clientSessionId: "client-session", accessToken: "test-token" };
    const body = openaiToAntigravityRequest(model, toolHistory(callId), true, credentials);

    await new AntigravityExecutor().execute({ model, body, stream: true, credentials });

    const sent = JSON.parse(proxyAwareFetch.mock.lastCall[1].body);
    expect(functionCallSignatures(sent)).toEqual([DEFAULT_THINKING_GEMINI_CLI_SIGNATURE]);
  });
});
