import { afterEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetchMock = vi.hoisted(() => vi.fn((url, init) => fetch(url, init)));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: proxyAwareFetchMock,
}));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(frames) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(enc.encode(`event: ${frame.event}\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify(frame.data)}\n\n`));
      }
      controller.close();
    },
  }), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("blocked OAuth/session provider port", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    proxyAwareFetchMock.mockClear();
  });

  it("devin-cli ACP handshake uses v1 protocolVersion and clientCapabilities", async () => {
    const { __test__ } = await import("../../open-sse/executors/devin-cli.js");
    expect(__test__.buildAcpInitializeParams()).toEqual({
      protocolVersion: 1,
      clientInfo: { name: "durindoor", version: "1.0" },
      clientCapabilities: {},
    });
  });

  it("devin-cli ACP session/new includes required mcpServers", async () => {
    const { __test__ } = await import("../../open-sse/executors/devin-cli.js");
    const params = __test__.buildAcpSessionNewParams();
    expect(params.mcpServers).toEqual([]);
    expect(typeof params.cwd).toBe("string");
  });

  it("registers gitlab-duo, trae, devin-cli, and windsurf specialized executors", async () => {
    const { getExecutor, hasSpecializedExecutor } = await import("../../open-sse/executors/index.js");

    for (const provider of ["gitlab-duo", "trae", "devin-cli", "windsurf"]) {
      expect(hasSpecializedExecutor(provider)).toBe(true);
      expect(getExecutor(provider).getProvider()).toBe(provider);
    }
  });

  it("exposes devin-cli and windsurf import-token metadata with windsurf guarded at runtime", async () => {
    const { PROVIDERS, PROVIDER_MODELS, PROVIDER_OAUTH } = await import("../../open-sse/providers/index.js");
    const { getProvider, generateAuthData } = await import("../../src/lib/oauth/providers.js");

    expect(PROVIDER_OAUTH["devin-cli"].flowType).toBe("import_token");
    expect(PROVIDER_OAUTH.windsurf.flowType).toBe("import_token");
    expect(PROVIDERS.windsurf.blockedReason).toMatch(/gRPC-web/);
    expect(PROVIDER_MODELS["gitlab-duo"].map((model) => model.id)).toContain("gitlab-duo-code-suggestions");
    expect(PROVIDER_MODELS.trae.map((model) => model.id)).toEqual(expect.arrayContaining(["auto", "work"]));
    expect(PROVIDER_MODELS["devin-cli"].map((model) => model.id)).toContain("devin-cli");
    expect(getProvider("devin-cli").flowType).toBe("import_token");
    expect(getProvider("windsurf").flowType).toBe("import_token");

    await expect(generateAuthData("devin-cli", "http://localhost/callback")).resolves.toMatchObject({
      authUrl: null,
      flowType: "import_token",
    });
  });

  it("devin-cli executor exposes ACP stdio contract", async () => {
    const { DevinCliExecutor, buildAcpPromptParams, parseAcpSessionUpdate } = await import("../../open-sse/executors/devin-cli.js");
    const executor = new DevinCliExecutor();

    expect(executor.buildUrl()).toBe("devin://acp/stdio");
    expect(executor.buildHeaders()).toEqual({});
    expect(executor.transformRequest()).toBeNull();
    expect(buildAcpPromptParams("sess-1", "hello")).toEqual({
      sessionId: "sess-1",
      prompt: [{ type: "text", text: "hello" }],
    });
    expect(parseAcpSessionUpdate({
      update: { sessionUpdate: "agent_message_chunk", content: { text: "chunk" } },
    })).toEqual({ kind: "delta", text: "chunk" });
  });

  it("devin-cli returns a non-OK JSON response for an explicitly missing binary", async () => {
    vi.stubEnv("CLI_DEVIN_BIN", "/definitely/missing/devin");
    const { DevinCliExecutor } = await import("../../open-sse/executors/devin-cli.js");

    const result = await new DevinCliExecutor().execute({
      model: "devin-cli",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: false,
    });

    expect(result.response.status).toBe(502);
    await expect(result.response.json()).resolves.toMatchObject({
      error: { type: "devin_cli_error" },
    });
  });

  it("windsurf executor returns an explicit not-implemented response instead of defaulting", async () => {
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const result = await new WindsurfExecutor().execute({});

    expect(result.response.status).toBe(501);
    await expect(result.response.json()).resolves.toMatchObject({
      error: {
        code: "windsurf_transport_blocked",
      },
    });
  });

  it("gitlab-duo posts code suggestion requests to configured GitLab instance", async () => {
    const { GitlabExecutor } = await import("../../open-sse/executors/gitlab.js");
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body || "{}")),
        headers: init.headers,
      });
      return jsonResponse({
        id: "gitlab-response-1",
        model: { name: "code-gecko" },
        choices: [{ text: "def hello():\n    return 'world'", finish_reason: "stop" }],
      });
    }));

    const executor = new GitlabExecutor();
    const result = await executor.execute({
      model: "gitlab-duo-code-suggestions",
      body: {
        messages: [
          { role: "system", content: "Return Python only." },
          { role: "user", content: "Write a helper" },
          { role: "assistant", content: "Assistant context" },
          { role: "user", content: "Write hello world" },
        ],
      },
      stream: false,
      credentials: {
        accessToken: "oauth-token",
        providerSpecificData: {
          baseUrl: "https://gitlab.example.com",
          projectPath: "group/project",
          fileName: "app.py",
        },
      },
      proxyOptions: { type: "http", url: "http://proxy.local:8080" },
    });

    expect(calls[0].url).toBe("https://gitlab.example.com/api/v4/code_suggestions/completions");
    expect(calls[0].headers.Authorization).toBe("Bearer oauth-token");
    const requestBody = calls[0].body;
    expect(requestBody).not.toHaveProperty("model_name");
    expect(requestBody.model_provider).toBeUndefined();
    expect(requestBody.project_path).toBe("group/project");
    expect(requestBody.current_file.file_name).toBe("app.py");
    expect(requestBody.current_file.content_above_cursor).toMatch(/System instructions/);
    expect(requestBody.current_file.content_above_cursor).toMatch(/User: Write a helper/);
    expect(requestBody.current_file.content_above_cursor).toMatch(/Assistant: Assistant context/);
    expect(requestBody.user_instruction).toMatch(/Write hello world/);
    expect(proxyAwareFetchMock).toHaveBeenCalledWith(
      "https://gitlab.example.com/api/v4/code_suggestions/completions",
      expect.any(Object),
      { type: "http", url: "http://proxy.local:8080" }
    );

    const body = await result.response.json();
    expect(body.model).toBe("code-gecko");
    expect(body.choices[0].message.content).toMatch(/hello/);
  });

  it("gitlab-duo omits model_name by default and uses upstreamModelName when configured", async () => {
    const { GitlabExecutor } = await import("../../open-sse/executors/gitlab.js");
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      calls.push({ body: JSON.parse(String(init.body || "{}")), });
      return jsonResponse({ id: "gitlab-response-2", model: { name: "code-gecko" }, choices: [{ text: "ok", finish_reason: "stop" }] });
    }));
    await new GitlabExecutor().execute({
      model: "gitlab-duo-code-suggestions",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { accessToken: "token", providerSpecificData: { baseUrl: "https://gitlab.example.com", projectPath: "p" } },
    });
    expect(calls[0].body).not.toHaveProperty("model_name");

    await new GitlabExecutor().execute({
      model: "gitlab-duo-code-suggestions",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { accessToken: "token", providerSpecificData: { baseUrl: "https://gitlab.example.com", projectPath: "p", upstreamModelName: "mistral" } },
    });
    expect(calls[1].body.model_name).toBe("mistral");
  });
  it("gitlab-duo refresh routes through proxyAwareFetch and preserves provider-specific data after retry", async () => {
    const { GitlabExecutor } = await import("../../open-sse/executors/gitlab.js");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ access_token: "refreshed", expires_in: 3600 })));

    const credentials = {
      refreshToken: "old-refresh",
      accessToken: "old",
      providerSpecificData: {
        baseUrl: "https://gitlab.example.com",
        clientId: "client-1",
        clientSecret: "secret-1",
        projectPath: "group/project",
        fileName: "app.py",
        intent: "generation",
        modelProvider: "mistral",
      },
    };
    const proxyOptions = { type: "http", url: "http://proxy.local:8080" };
    const result = await new GitlabExecutor().refreshCredentials(credentials, null, proxyOptions);

    expect(proxyAwareFetchMock).toHaveBeenCalledWith(
      "https://gitlab.example.com/oauth/token",
      expect.any(Object),
      proxyOptions
    );
    expect(result).toMatchObject({
      accessToken: "refreshed",
      providerSpecificData: {
        baseUrl: "https://gitlab.example.com",
        clientId: "client-1",
      },
    });
    expect(credentials.providerSpecificData.projectPath).toBe("group/project");
    expect(credentials.providerSpecificData.fileName).toBe("app.py");
    expect(credentials.providerSpecificData.modelProvider).toBe("mistral");
  });

  it("gitlab-duo refreshes OAuth access tokens with instance metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      const urlString = String(url);
      if (urlString === "https://gitlab.example.com/oauth/token") {
        const body = new URLSearchParams(String(init.body || ""));
        expect(body.get("client_id")).toBe("client-1");
        expect(body.get("client_secret")).toBe("secret-1");
        expect(body.get("code_verifier")).toBe("verifier-1");
        return jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          scope: "api",
        });
      }
      expect(urlString).toBe("https://gitlab.example.com/api/v4/user");
      expect(init.headers.Authorization).toBe("Bearer new-access");
      return jsonResponse({
        username: "duo-user",
        email: "duo@example.com",
        name: "GitLab Duo User",
      });
    }));

    const { exchangeTokens } = await import("../../src/lib/oauth/providers.js");
    await expect(exchangeTokens(
      "gitlab-duo",
      "code-1",
      "http://localhost/callback",
      "verifier-1",
      "state-1",
      { baseUrl: "https://gitlab.example.com", clientId: "client-1", clientSecret: "secret-1" }
    )).resolves.toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      providerSpecificData: {
        username: "duo-user",
        baseUrl: "https://gitlab.example.com",
        clientId: "client-1",
        clientSecret: "secret-1",
      },
    });
  });

  it("redacts gitlab-duo client secrets from provider read APIs", async () => {
    vi.resetModules();
    vi.doMock("next/server", () => ({
      NextResponse: {
        json(body, init = {}) {
          return jsonResponse(body, init.status || 200);
        },
      },
    }));
    vi.doMock("@/models", () => ({
      getProviderConnections: vi.fn(async () => ([{
        id: "conn-1",
        provider: "gitlab-duo",
        authType: "oauth",
        name: "GitLab Duo",
        apiKey: "api-key-secret",
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        idToken: "id-secret",
        providerSpecificData: {
          baseUrl: "https://gitlab.example.com",
          clientId: "client-1",
          clientSecret: "secret-1",
          authKind: "oauth",
        },
      }])),
      createProviderConnection: vi.fn(),
      getProviderNodeById: vi.fn(),
      getProviderNodes: vi.fn(async () => []),
      getProxyPoolById: vi.fn(),
    }));

    try {
      const { GET } = await import("../../src/app/api/providers/route.js");
      const response = await GET();
      const body = await response.json();

      expect(body.connections[0].apiKey).toBeUndefined();
      expect(body.connections[0].accessToken).toBeUndefined();
      expect(body.connections[0].refreshToken).toBeUndefined();
      expect(body.connections[0].idToken).toBeUndefined();
      expect(body.connections[0].providerSpecificData).toMatchObject({
        baseUrl: "https://gitlab.example.com",
        clientId: "client-1",
        authKind: "oauth",
      });
      expect(body.connections[0].providerSpecificData.clientSecret).toBeUndefined();
    } finally {
      vi.doUnmock("next/server");
      vi.doUnmock("@/models");
      vi.resetModules();
    }
  });

  it("trae preserves structured import-token identity metadata", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const mapped = getProvider("trae").mapTokens({
      accessToken: "jwt-token",
      webId: "web-1",
      bizUserId: "biz-1",
      userUniqueId: "user-1",
      tenant: "tenant-1",
      scope: "scope-1",
      region: "EU-West",
    });

    expect(mapped).toMatchObject({
      accessToken: "jwt-token",
      providerSpecificData: {
        webId: "web-1",
        bizUserId: "biz-1",
        userUniqueId: "user-1",
        tenant: "tenant-1",
        scope: "scope-1",
        region: "EU-West",
      },
    });
  });

  it("trae maps Cloud-IDE-JWT session events to non-streaming OpenAI completions", async () => {
    const calls = {};
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      const urlString = String(url);
      if (urlString.endsWith("/chat_sessions")) {
        calls.sessionBody = JSON.parse(String(init.body || "{}"));
        calls.headers = init.headers;
        return jsonResponse({
          code: 0,
          data: { chat_session_id: "sess1", message_id: "msg1" },
        });
      }
      if (urlString.includes("/chat_sessions/sess1/events")) {
        calls.eventsUrl = urlString;
        return sseResponse([
          { event: "plan_item", data: { id: "p1", thought: "Hel" } },
          { event: "plan_item", data: { id: "p1", thought: "Hello" } },
          { event: "token_usage", data: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
          { event: "done", data: { status: "completed" } },
        ]);
      }
      throw new Error(`unexpected fetch ${urlString}`);
    }));

    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");
    const result = await new TraeExecutor().execute({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "say hello" }] },
      stream: false,
      credentials: {
        accessToken: "jwt-token",
        providerSpecificData: { webId: "web-1", bizUserId: "biz-1", userUniqueId: "user-1" },
      },
      proxyOptions: { type: "socks", url: "socks://proxy.local:1080" },
    });

    expect(calls.headers.Authorization).toBe("Cloud-IDE-JWT jwt-token");
    expect(calls.sessionBody.initial_message.model_selection_strategy).toBe("manual");
    expect(calls.sessionBody.initial_message.model_name).toBe("gpt-5.2");
    expect(calls.eventsUrl).toContain("reply_to_message_id=msg1");
    expect(proxyAwareFetchMock).toHaveBeenCalledWith(
      "https://core-normal.trae.ai/api/remote/v1/chat_sessions",
      expect.any(Object),
      { type: "socks", url: "socks://proxy.local:1080" }
    );
    expect(proxyAwareFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/chat_sessions/sess1/events"),
      expect.any(Object),
      { type: "socks", url: "socks://proxy.local:1080" }
    );

    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("Hello");
    expect(body.usage).toEqual({ prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 });
  });

  it("trae work model selects SOLO work mode", async () => {
    const calls = {};
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      const urlString = String(url);
      if (urlString.endsWith("/chat_sessions")) {
        calls.sessionBody = JSON.parse(String(init.body || "{}"));
        return jsonResponse({ code: 0, data: { chat_session_id: "sess1", message_id: "msg1" } });
      }
      return sseResponse([{ event: "done", data: { status: "completed" } }]);
    }));

    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");
    await new TraeExecutor().execute({
      model: "work",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { accessToken: "jwt-token" },
    });

    expect(calls.sessionBody.mode).toBe("work");
    expect(calls.sessionBody.initial_message.model_selection_strategy).toBe("auto");
    expect(calls.sessionBody.initial_message.model_name).toBe("");
    expect(JSON.parse(calls.sessionBody.initial_message.common_params).solo_chat_mode).toBe("work");
  });
});
