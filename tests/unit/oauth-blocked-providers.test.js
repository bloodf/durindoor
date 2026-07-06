import { afterEach, describe, expect, it, vi } from "vitest";

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
  });

  it("registers gitlab-duo, trae, devin-cli, and windsurf specialized executors", async () => {
    const { getExecutor, hasSpecializedExecutor } = await import("../../open-sse/executors/index.js");

    for (const provider of ["gitlab-duo", "trae", "devin-cli", "windsurf"]) {
      expect(hasSpecializedExecutor(provider)).toBe(true);
      expect(getExecutor(provider).getProvider()).toBe(provider);
    }
  });

  it("exposes devin-cli and windsurf import-token metadata with windsurf guarded at runtime", async () => {
    const { PROVIDERS, PROVIDER_OAUTH } = await import("../../open-sse/providers/index.js");
    const { getProvider, generateAuthData } = await import("../../src/lib/oauth/providers.js");

    expect(PROVIDER_OAUTH["devin-cli"].flowType).toBe("import_token");
    expect(PROVIDER_OAUTH.windsurf.flowType).toBe("import_token");
    expect(PROVIDERS.windsurf.blockedReason).toMatch(/gRPC-web/);
    expect(getProvider("devin-cli").flowType).toBe("import_token");
    expect(getProvider("windsurf").flowType).toBe("import_token");

    await expect(generateAuthData("devin-cli", "http://localhost/callback")).resolves.toMatchObject({
      authUrl: null,
      flowType: "import_token",
    });
  });

  it("devin-cli executor exposes ACP stdio contract", async () => {
    const { DevinCliExecutor } = await import("../../open-sse/executors/devin-cli.js");
    const executor = new DevinCliExecutor();

    expect(executor.buildUrl()).toBe("devin://acp/stdio");
    expect(executor.buildHeaders()).toEqual({});
    expect(executor.transformRequest()).toBeNull();
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
    });

    expect(calls[0].url).toBe("https://gitlab.example.com/api/v4/code_suggestions/completions");
    expect(calls[0].headers.Authorization).toBe("Bearer oauth-token");
    expect(calls[0].body.project_path).toBe("group/project");
    expect(calls[0].body.current_file.file_name).toBe("app.py");
    expect(calls[0].body.current_file.content_above_cursor).toMatch(/System instructions/);
    expect(calls[0].body.user_instruction).toMatch(/Write hello world/);

    const body = await result.response.json();
    expect(body.model).toBe("code-gecko");
    expect(body.choices[0].message.content).toMatch(/hello/);
  });

  it("gitlab-duo refreshes OAuth access tokens with instance metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      expect(String(url)).toBe("https://gitlab.example.com/oauth/token");
      expect(init.body.get("grant_type")).toBe("refresh_token");
      expect(init.body.get("refresh_token")).toBe("old-refresh");
      return jsonResponse({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      });
    }));

    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
    await expect(refreshTokenByProvider("gitlab-duo", {
      refreshToken: "old-refresh",
      providerSpecificData: { baseUrl: "https://gitlab.example.com", clientId: "client-1" },
    }, null)).resolves.toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 3600,
      providerSpecificData: {
        baseUrl: "https://gitlab.example.com",
        clientId: "client-1",
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
    });

    expect(calls.headers.Authorization).toBe("Cloud-IDE-JWT jwt-token");
    expect(calls.sessionBody.initial_message.model_selection_strategy).toBe("manual");
    expect(calls.sessionBody.initial_message.model_name).toBe("gpt-5.2");
    expect(calls.eventsUrl).toContain("reply_to_message_id=msg1");

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
