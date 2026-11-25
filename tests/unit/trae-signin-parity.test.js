import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Closed outbound mocks only: every fetch in this file is stubbed, no live
// provider call is made, and no credential is read from a real session.
//
// Comparison snapshots for the contracts asserted here:
//   router-for-me/CLIProxyAPI     6faa8d20b2673404cff70a2f2d9537ae0d0e684d (no Trae support)
//   router-for-me/EasyCLIProxyAPI  e4223d5eefa22a3301ca7e2a28d05897432b07f9 (no Trae support)
//   cheaper-inference/OmniRoute    e3c1531afd07d5e06f7ffab658584a7ae2e3627e
//     open-sse/executors/trae.ts, src/lib/oauth/providers/trae.ts,
//     src/app/api/oauth/trae/import/route.ts, open-sse/config/providers/registry/trae/index.ts
//     (Trae origin/timezone/region work: issue #12190, PR #13255,
//      commit 1fb7d5dff2ea1e626322bd9d44205cf9c288e284)

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn()
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => new Response(JSON.stringify(body), {
      status: init?.status || 200,
      headers: { "Content-Type": "application/json" }
    })
  }
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({
  ensureOutboundProxyInitialized: mocks.ensureOutboundProxyInitialized
}));
vi.mock("@/lib/localDb", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  getProxyPoolById: vi.fn()
}));

const FAKE_JWT = "fake-trae-jwt";
const TRAE_HOST = "https://core-normal.trae.ai/";

function sseResponse(frames) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        if (frame.event) controller.enqueue(enc.encode(`event: ${frame.event}\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify(frame.data)}\n\n`));
      }
      controller.close();
    }
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/**
 * Closed mock for the two Trae SOLO calls: POST /chat_sessions and the
 * follow-up GET .../events stream. Every request is recorded so a test can
 * assert where the credential travelled.
 */
function stubTraeFetch({ frames = [{ event: "done", data: {} }] } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const urlString = String(url);
    calls.push({ url: urlString, headers: init.headers || {}, body: init.body });
    if (urlString.endsWith("/chat_sessions")) {
      return new Response(JSON.stringify({
        code: 0,
        data: { chat_session_id: "session-1", message_id: "message-1" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (urlString.includes("/events")) return sseResponse(frames);
    throw new Error(`unexpected fetch ${urlString}`);
  }));
  return calls;
}

describe("Trae import-token sign-in contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps a pasted Cloud-IDE-JWT to the SOLO identity defaults", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const provider = getProvider("trae");

    expect(provider.flowType).toBe("import_token");
    expect(provider.buildAuthUrl()).toBeNull();

    const mapped = provider.mapTokens(FAKE_JWT);
    expect(mapped.accessToken).toBe(FAKE_JWT);
    expect(mapped.refreshToken).toBeNull();
    expect(mapped.expiresIn).toBe(14 * 24 * 60 * 60);
    expect(mapped.providerSpecificData).toMatchObject({
      webId: "",
      bizUserId: "",
      userUniqueId: "",
      scope: "marscode-us",
      tenant: "marscode",
      region: "US-East",
      aiRegion: "US-East",
      appLanguage: "en",
      appVersion: "1.0.0.1229",
      userRegion: "US",
      userIdentity: "Free",
      authMethod: "imported"
    });
    // No timezone is claimed unless the operator supplied one.
    expect(mapped.providerSpecificData.userTimezone).toBeUndefined();
  });

  it("keeps a supplied account region and timezone from the import request body", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");

    const mapped = getProvider("trae").mapTokens(FAKE_JWT, {
      accessToken: FAKE_JWT,
      webId: "WID",
      bizUserId: "BUID",
      userUniqueId: "UUID",
      userRegion: "SG",
      userTimezone: "America/Recife"
    });

    expect(mapped.accessToken).toBe(FAKE_JWT);
    expect(mapped.providerSpecificData).toMatchObject({
      webId: "WID",
      bizUserId: "BUID",
      userUniqueId: "UUID",
      userRegion: "SG",
      userTimezone: "America/Recife"
    });
  });

  it("prefers credential fields over the import request body", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");

    const mapped = getProvider("trae").mapTokens(
      { accessToken: FAKE_JWT, userRegion: "SG" },
      { userRegion: "US", userTimezone: "Europe/Lisbon" }
    );

    expect(mapped.providerSpecificData.userRegion).toBe("SG");
    expect(mapped.providerSpecificData.userTimezone).toBe("Europe/Lisbon");
  });

  it("reads the snake_case field spellings a pasted session payload uses", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");

    const mapped = getProvider("trae").mapTokens({
      access_token: FAKE_JWT,
      web_id: "WID",
      biz_user_id: "BUID",
      user_unique_id: "UUID",
      user_region: "SG",
      user_timezone: "Asia/Singapore"
    });

    expect(mapped.accessToken).toBe(FAKE_JWT);
    expect(mapped.providerSpecificData).toMatchObject({
      webId: "WID",
      bizUserId: "BUID",
      userUniqueId: "UUID",
      userRegion: "SG",
      userTimezone: "Asia/Singapore"
    });
  });
  it("tolerates a null credential instead of throwing", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");

    const mapped = getProvider("trae").mapTokens(null, null);
    expect(mapped.accessToken).toBe("");
  });
});

describe("Trae import-token route", () => {
  beforeEach(() => {
    mocks.createProviderConnection.mockReset();
    mocks.ensureOutboundProxyInitialized.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function postImport(body) {
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    return POST(
      { json: async () => body },
      { params: { provider: "trae", action: "import-token" } }
    );
  }

  it("stores the connection and never echoes the credential back", async () => {
    mocks.createProviderConnection.mockResolvedValue({
      id: "conn-1",
      provider: "trae",
      email: null,
      displayName: null
    });

    const response = await postImport({
      accessToken: FAKE_JWT,
      refreshToken: "fake-unused-refresh",
      userRegion: "SG"
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.connection).toMatchObject({ id: "conn-1", provider: "trae" });
    // Credential isolation: the imported token must not come back to the client.
    expect(JSON.stringify(body)).not.toContain(FAKE_JWT);

    const stored = mocks.createProviderConnection.mock.calls[0][0];
    expect(stored.provider).toBe("trae");
    expect(stored.authType).toBe("oauth");
    expect(stored.accessToken).toBe(FAKE_JWT);
    expect(stored.providerSpecificData.userRegion).toBe("SG");
    expect(stored.refreshToken).toBeNull();
    expect(stored.expiresAt).toBeTruthy();
  });

  it("rejects a payload whose credential is not a token string", async () => {
    const response = await postImport({ accessToken: { nested: "object" } });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Missing accessToken");
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
  });

  it("rejects a payload with no credential at all", async () => {
    const response = await postImport({ webId: "WID" });

    expect(response.status).toBe(400);
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
  });
});

describe("Trae request headers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sends the current Trae web origin, not the retired solo.trae.ai host", async () => {
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");

    const headers = new TraeExecutor().buildHeaders({
      accessToken: FAKE_JWT,
      providerSpecificData: { webId: "WID" }
    });

    expect(headers.Referer).toBe("https://work.trae.ai/");
    expect(headers.Origin).toBe("https://work.trae.ai");
    expect(headers.Referer).not.toContain("solo.trae.ai");
  });

  it("keeps the Cloud-IDE-JWT credential scheme", async () => {
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");

    const headers = new TraeExecutor().buildHeaders({ accessToken: FAKE_JWT });

    expect(headers.Authorization).toBe(`Cloud-IDE-JWT ${FAKE_JWT}`);
    expect(headers.Authorization).not.toContain("Bearer");
  });

  it("lets a per-connection refererOrigin override the fleet default", async () => {
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");

    const headers = new TraeExecutor().buildHeaders({
      accessToken: FAKE_JWT,
      providerSpecificData: { refererOrigin: "https://solo.trae.ai" }
    });

    expect(headers.Referer).toBe("https://solo.trae.ai/");
    expect(headers.Origin).toBe("https://solo.trae.ai");
  });

  it("ignores a malformed refererOrigin instead of emitting a broken header", async () => {
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");

    const headers = new TraeExecutor().buildHeaders({
      accessToken: FAKE_JWT,
      providerSpecificData: { refererOrigin: "not-a-url" }
    });

    expect(headers.Origin).toBe("https://work.trae.ai");
    expect(headers.Referer).toBe("https://work.trae.ai/");
  });

  it("honors TRAE_WEB_ORIGIN for a fleet-wide bump", async () => {
    const previous = process.env.TRAE_WEB_ORIGIN;
    process.env.TRAE_WEB_ORIGIN = "https://trae.example";
    vi.resetModules();
    try {
      const { TraeExecutor } = await import("../../open-sse/executors/trae.js");

      const headers = new TraeExecutor().buildHeaders({ accessToken: FAKE_JWT });

      expect(headers.Origin).toBe("https://trae.example");
      expect(headers.Referer).toBe("https://trae.example/");
    } finally {
      if (previous === undefined) delete process.env.TRAE_WEB_ORIGIN;
      else process.env.TRAE_WEB_ORIGIN = previous;
      vi.resetModules();
    }
  });

  it("forwards x-trae-user-timezone only when the connection carries one", async () => {
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");
    const executor = new TraeExecutor();

    const withTimezone = executor.buildHeaders({
      accessToken: FAKE_JWT,
      providerSpecificData: { userTimezone: "America/Recife" }
    });
    expect(withTimezone["x-trae-user-timezone"]).toBe("America/Recife");

    const withoutTimezone = executor.buildHeaders({ accessToken: FAKE_JWT });
    expect(Object.hasOwn(withoutTimezone, "x-trae-user-timezone")).toBe(false);
  });

  it("uses the connection's user region and defaults to US", async () => {
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");
    const executor = new TraeExecutor();

    expect(executor.buildHeaders({
      accessToken: FAKE_JWT,
      providerSpecificData: { userRegion: "SG" }
    })["x-user-region"]).toBe("SG");

    expect(executor.buildHeaders({ accessToken: FAKE_JWT })["x-user-region"]).toBe("US");
  });
});

describe("Trae streamed request handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("carries the connection identity into the SOLO common_params payload", async () => {
    const calls = stubTraeFetch();
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");

    await new TraeExecutor().execute({
      model: "auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: {
        accessToken: FAKE_JWT,
        providerSpecificData: {
          webId: "WID",
          bizUserId: "BUID",
          userUniqueId: "UUID",
          scope: "marscode-us",
          tenant: "marscode",
          region: "US-East"
        }
      }
    });

    const created = JSON.parse(calls[0].body);
    expect(created.mode).toBe("code");
    expect(created.initial_message.agent_type).toBe("solo_agent_remote");
    expect(created.initial_message.model_name).toBe("");
    expect(created.initial_message.model_selection_strategy).toBe("auto");
    expect(JSON.parse(created.initial_message.common_params)).toMatchObject({
      web_id: "WID",
      biz_user_id: "BUID",
      user_unique_id: "UUID",
      scope: "marscode-us",
      tenant: "marscode",
      region: "US-East",
      aiRegion: "US-East",
      app_language: "en",
      app_version: "1.0.0.1229",
      user_identity: "Free",
      solo_chat_mode: "code"
    });
  });

  it("resolves the work model to the SOLO work mode", async () => {
    const calls = stubTraeFetch();
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");

    await new TraeExecutor().execute({
      model: "work",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { accessToken: FAKE_JWT, providerSpecificData: {} }
    });

    const created = JSON.parse(calls[0].body);
    expect(created.mode).toBe("work");
    expect(created.initial_message.model_name).toBe("");
    expect(created.initial_message.model_selection_strategy).toBe("auto");
    expect(JSON.parse(created.initial_message.common_params).solo_chat_mode).toBe("work");
  });

  it("streams plan_item thoughts as OpenAI chunks and closes with [DONE]", async () => {
    stubTraeFetch({
      frames: [
        { event: "plan_item", data: { id: "p1", thought: "Hello" } },
        { event: "token_usage", data: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
        { event: "done", data: { status: "completed" } }
      ]
    });
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");

    const result = await new TraeExecutor().execute({
      model: "auto",
      body: { messages: [{ role: "user", content: "say hello" }] },
      stream: true,
      credentials: { accessToken: FAKE_JWT, providerSpecificData: {} }
    });

    expect(result.response.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await result.response.text();
    const chunks = text
      .split("\n\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map((line) => JSON.parse(line.slice("data: ".length)));

    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    const content = chunks
      .map((chunk) => chunk.choices?.[0]?.delta?.content || "")
      .join("");
    expect(content).toBe("Hello");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
    expect(text).toContain("data: [DONE]");
  });

  it("returns a chat.completion body for a non-streaming request", async () => {
    stubTraeFetch({
      frames: [
        { event: "plan_item", data: { id: "p1", thought: "Hello" } },
        { event: "token_usage", data: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
        { event: "done", data: { status: "completed" } }
      ]
    });
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");

    const result = await new TraeExecutor().execute({
      model: "auto",
      body: { messages: [{ role: "user", content: "say hello" }] },
      stream: false,
      credentials: { accessToken: FAKE_JWT, providerSpecificData: {} }
    });

    const body = await result.response.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message).toEqual({ role: "assistant", content: "Hello" });
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage).toEqual({ prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
  });

  it("keeps each connection's credential in the Trae authorization header", async () => {
    const calls = stubTraeFetch();
    const { getExecutor } = await import("../../open-sse/executors/index.js");
    const executor = getExecutor("trae");
    const tokens = [FAKE_JWT, "fake-second-trae-jwt"];

    for (const accessToken of tokens) {
      const { response } = await executor.execute({
        model: "auto",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { accessToken }
      });
      expect(response.ok).toBe(true);
    }

    expect(calls).toHaveLength(4);
    for (const [index, call] of calls.entries()) {
      const { Authorization, ...headers } = call.headers;
      expect(call.url.startsWith(TRAE_HOST)).toBe(true);
      expect(Authorization).toBe(`Cloud-IDE-JWT ${tokens[Math.floor(index / 2)]}`);
      for (const token of tokens) {
        expect(JSON.stringify([call.url, call.body, headers])).not.toContain(token);
      }
    }
  });
});

describe("Trae catalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("publishes the SOLO model catalog under the alias and the provider id", async () => {
    const { PROVIDER_MODELS } = await import("../../open-sse/providers/index.js");
    const { getModelsByProviderId } = await import("../../open-sse/config/providerModels.js");

    const expected = [
      "auto",
      "work",
      "gemini-3.1-pro",
      "gemini-3-flash-solo",
      "minimax-m3",
      "minimax-m2.7",
      "kimi-k2.5",
      "gpt-5.4",
      "gpt-5.2"
    ];

    expect(PROVIDER_MODELS.tr.map((model) => model.id)).toEqual(expected);
    expect(getModelsByProviderId("trae").map((model) => model.id)).toEqual(expected);
  });

  it("keeps the SOLO base URL and the upstream default context length", async () => {
    const { PROVIDERS } = await import("../../open-sse/providers/index.js");

    expect(PROVIDERS.trae.baseUrl).toBe("https://core-normal.trae.ai/api/remote/v1");
    expect(PROVIDERS.trae.defaultContextLength).toBe(272000);
  });

  it("still declares Trae as an import_token OAuth provider", async () => {
    const { PROVIDER_OAUTH } = await import("../../open-sse/providers/index.js");

    expect(PROVIDER_OAUTH.trae.flowType).toBe("import_token");
    expect(PROVIDER_OAUTH.trae.tokenLifetimeDays).toBe(14);
  });
});
