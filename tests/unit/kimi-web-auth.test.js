import { describe, it, expect, vi, afterEach } from "vitest";
import { extractKimiTokens } from "../../src/lib/providers/webCookieAuth.js";

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import {
  KimiWebExecutor,
  kimiRefreshUrl,
  resolveKimiTokens,
  resolveReasoningEffort,
  resolveModelConfig,
  sessionSource,
} from "../../open-sse/executors/kimi-web.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

afterEach(() => vi.clearAllMocks());

const ACCESS = "eyJhbGciOiJIUzUxMiJ9.eyJ0eXAiOiJhY2Nlc3MifQ.access";
const REFRESH = "eyJhbGciOiJIUzUxMiJ9.eyJ0eXAiOiJyZWZyZXNoIn0.refresh";

function emptyStream() {
  return new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 });
}

function sentChat(callIndex = 0) {
  const [url, init] = proxyAwareFetch.mock.calls[callIndex];
  return { url, headers: init.headers, body: JSON.parse(Buffer.from(init.body.slice(5)).toString("utf8")) };
}

describe("extractKimiTokens", () => {
  it("reads the JSON the console snippet copies", () => {
    expect(
      extractKimiTokens(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, origin: "https://www.kimi.ai" }))
    ).toEqual({ accessToken: ACCESS, refreshToken: REFRESH, origin: "https://www.kimi.ai" });
  });

  it("drops an origin that is not a known Kimi host", () => {
    const raw = JSON.stringify({ access_token: ACCESS, origin: "https://evil.example" });
    expect(extractKimiTokens(raw).origin).toBe("");
  });

  it("treats a logged-out snippet (null tokens) and bad JSON as empty", () => {
    const empty = { accessToken: "", refreshToken: "", origin: "" };
    expect(extractKimiTokens('{"access_token":null,"refresh_token":null}')).toEqual(empty);
    expect(extractKimiTokens("{not json")).toEqual(empty);
    expect(extractKimiTokens("")).toEqual(empty);
  });

  it("accepts a bare or JSON-quoted access token", () => {
    expect(extractKimiTokens(ACCESS)).toEqual({ accessToken: ACCESS, refreshToken: "", origin: "" });
    expect(extractKimiTokens(`"${ACCESS}"`)).toEqual({ accessToken: ACCESS, refreshToken: "", origin: "" });
  });

  it("accepts access_token= / refresh_token= pairs", () => {
    expect(extractKimiTokens(`access_token=${ACCESS}; refresh_token=${REFRESH}`)).toEqual({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      origin: "",
    });
  });

  it("still accepts the legacy kimi-auth Cookie header and Bearer forms", () => {
    expect(extractKimiTokens(`_ga=1; kimi-auth=${ACCESS}; theme=dark`).accessToken).toBe(ACCESS);
    expect(extractKimiTokens(`Cookie: kimi-auth=${ACCESS}`).accessToken).toBe(ACCESS);
    expect(extractKimiTokens(`Authorization: Bearer ${ACCESS}`).accessToken).toBe(ACCESS);
    expect(extractKimiTokens("_ga=1; theme=dark").accessToken).toBe("");
  });
});

describe("kimi-web registry auth hint", () => {
  it("exposes the console copy snippet to the connect dialog", () => {
    const entry = AI_PROVIDERS["kimi-web"];
    expect(entry.authSnippet).toContain("localStorage.getItem('access_token')");
    expect(entry.authSnippet).toContain("localStorage.getItem('refresh_token')");
    expect(entry.authSnippet).toContain("origin:location.origin");
    expect(entry.authSnippet.startsWith("copy(")).toBe(true);
    expect(entry.authHint).toMatch(/localStorage/);
  });
});

describe("kimi-web request shape", () => {
  it("sends only the Bearer access token, never a Cookie or the refresh token", async () => {
    proxyAwareFetch.mockResolvedValue(emptyStream());
    await new KimiWebExecutor().execute({
      body: { model: "k2d6", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH }) },
      stream: false,
    });
    const { url, headers } = sentChat();
    expect(url).toBe("https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat");
    expect(headers.Authorization).toBe(`Bearer ${ACCESS}`);
    expect(headers.Cookie).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain(REFRESH);
  });

  it("sends a www.kimi.ai session to www.kimi.ai", async () => {
    proxyAwareFetch.mockResolvedValue(emptyStream());
    await new KimiWebExecutor().execute({
      body: { model: "k2d6", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: JSON.stringify({ access_token: ACCESS, origin: "https://www.kimi.ai" }) },
      stream: false,
    });
    const { url, headers } = sentChat();
    expect(url).toBe("https://www.kimi.ai/apiv2/kimi.gateway.chat.v1.ChatService/Chat");
    expect(headers.Origin).toBe("https://www.kimi.ai");
  });

  it("shapes k3 like the web app (OK Computer scenario, model, default HIGH effort)", async () => {
    proxyAwareFetch.mockResolvedValue(emptyStream());
    await new KimiWebExecutor().execute({
      body: { model: "k3", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: ACCESS },
      stream: false,
    });
    const { body } = sentChat();
    expect(body).toMatchObject({
      chat_id: "",
      kimiplus_id: "ok-computer",
      scenario: "SCENARIO_OK_COMPUTER",
      project_id: "",
      message: { role: "user", scenario: "SCENARIO_OK_COMPUTER" },
      options: { thinking: true, model: "k3", reasoning_effort: "REASONING_EFFORT_HIGH" },
    });
  });

  it("maps OpenAI reasoning_effort to the nearest Kimi tier", () => {
    const k3 = resolveModelConfig("k3");
    const k2d6 = resolveModelConfig("k2d6");
    expect(resolveReasoningEffort(k3, "none")).toBe("REASONING_EFFORT_LOW");
    expect(resolveReasoningEffort(k3, "low")).toBe("REASONING_EFFORT_LOW");
    expect(resolveReasoningEffort(k3, "medium")).toBe("REASONING_EFFORT_HIGH");
    expect(resolveReasoningEffort(k3, "xhigh")).toBe("REASONING_EFFORT_MAX");
    expect(resolveReasoningEffort(k2d6, undefined)).toBe("REASONING_EFFORT_NONE");
    expect(resolveReasoningEffort(k2d6, "high")).toBe("REASONING_EFFORT_LOW");
    expect(resolveReasoningEffort(k2d6, "none")).toBe("REASONING_EFFORT_NONE");
  });
});

describe("kimi-web token refresh", () => {
  it("trades the refresh token at auth.kimi.com and reuses the rotated pair", async () => {
    const pastedRefresh = "eyJhbGciOiJIUzUxMiJ9.eyJyb3RhdGUiOjF9.pasted";
    const apiKey = JSON.stringify({ access_token: ACCESS, refresh_token: pastedRefresh });
    const newAccess = "eyJhbGciOiJIUzUxMiJ9.eyJuZXciOjF9.newaccess";
    const newRefresh = "eyJhbGciOiJIUzUxMiJ9.eyJuZXciOjJ9.newrefresh";
    proxyAwareFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accessToken: newAccess, refreshToken: newRefresh }), { status: 200 })
    );

    const executor = new KimiWebExecutor();
    const refreshed = await executor.refreshCredentials({ apiKey });
    expect(refreshed).toMatchObject({ accessToken: newAccess, refreshToken: newRefresh });

    expect(refreshed.providerSpecificPatch.kimiWebSessionSource).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(refreshed.providerSpecificPatch)).not.toContain(newAccess);

    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://auth.kimi.com/api/account.gateway.v1.AuthService/RefreshToken");
    expect(init.method).toBe("POST");
    expect(init.headers["connect-protocol-version"]).toBe("1");
    expect(JSON.parse(init.body)).toEqual({ refresh_token: pastedRefresh });

    // A later request on the same stored paste uses the rotated access token.
    proxyAwareFetch.mockResolvedValueOnce(emptyStream());
    await executor.execute({
      body: { model: "k2d6", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey },
      stream: false,
    });
    expect(sentChat(1).headers.Authorization).toBe(`Bearer ${newAccess}`);
  });

  it("returns null without a refresh token or when Kimi rejects it", async () => {
    const executor = new KimiWebExecutor();
    expect(await executor.refreshCredentials({ apiKey: `kimi-auth=${ACCESS}` })).toBeNull();
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(new Response('{"code":"unauthenticated"}', { status: 401 }));
    const rejected = await executor.refreshCredentials({
      apiKey: JSON.stringify({ access_token: ACCESS, refresh_token: "eyJ.revoked.x" }),
    });
    expect(rejected).toBeNull();
  });
});

describe("kimi-web persisted rotation", () => {
  it("maps each site to its auth host", () => {
    expect(kimiRefreshUrl("https://www.kimi.ai")).toBe(
      "https://auth.kimi.ai/api/account.gateway.v1.AuthService/RefreshToken"
    );
  });

  it("uses the stored token columns only while they belong to the current paste", () => {
    const pastedRefresh = "eyJhbGciOiJIUzUxMiJ9.eyJwZXJzaXN0IjoxfQ.never-refreshed-here";
    const apiKey = JSON.stringify({ access_token: ACCESS, refresh_token: pastedRefresh });
    const stored = { accessToken: "eyJ.stored.access", refreshToken: "eyJ.stored.refresh" };
    const providerSpecificData = { kimiWebSessionSource: sessionSource(pastedRefresh) };

    // After a restart the in-memory map is empty; the columns carry the rotation.
    expect(resolveKimiTokens({ apiKey, ...stored, providerSpecificData })).toMatchObject(stored);

    // A new paste (different refresh token) ignores the older rotation.
    const repasted = JSON.stringify({ access_token: ACCESS, refresh_token: "eyJ.new.paste" });
    expect(resolveKimiTokens({ apiKey: repasted, ...stored, providerSpecificData })).toMatchObject({
      accessToken: ACCESS,
      refreshToken: "eyJ.new.paste",
    });
  });
});

describe("kimi-web 401 → refresh → retry through chatCore", () => {
  it("retries with the refreshed token and hands the pair to onCredentialsRefreshed", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const pastedRefresh = "eyJhbGciOiJIUzUxMiJ9.eyJjb3JlIjoxfQ.core-refresh";
    const newAccess = "eyJhbGciOiJIUzUxMiJ9.eyJjb3JlIjoyfQ.core-access";
    const endFrame = Buffer.concat([Buffer.from([2, 0, 0, 0, 2]), Buffer.from("{}")]);
    const textFrame = (() => {
      const json = Buffer.from(JSON.stringify({ op: "set", mask: "block.text", block: { text: { content: "pong" } } }));
      const head = Buffer.alloc(5);
      head.writeUInt32BE(json.length, 1);
      return Buffer.concat([head, json]);
    })();
    proxyAwareFetch.mockImplementation(async (url, init) => {
      if (String(url).includes("AuthService/RefreshToken")) {
        return new Response(JSON.stringify({ access_token: newAccess, refresh_token: pastedRefresh }), { status: 200 });
      }
      if (init.headers.Authorization === `Bearer ${ACCESS}`) {
        return new Response('{"code":"unauthenticated"}', { status: 401 });
      }
      return new Response(Buffer.concat([textFrame, endFrame]), { status: 200 });
    });
    const onCredentialsRefreshed = vi.fn();

    const result = await handleChatCore({
      body: { model: "k2d6", stream: false, messages: [{ role: "user", content: "ping" }] },
      modelInfo: { provider: "kimi-web", model: "k2d6" },
      credentials: {
        connectionId: "conn-kimi-refresh",
        apiKey: JSON.stringify({ access_token: ACCESS, refresh_token: pastedRefresh }),
      },
      onCredentialsRefreshed,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
      userAgent: "kimi-refresh-test",
    });

    expect(result.success).toBe(true);
    const chatAuth = proxyAwareFetch.mock.calls
      .filter(([url]) => String(url).includes("ChatService/Chat"))
      .map(([, init]) => init.headers.Authorization);
    expect(chatAuth).toEqual([`Bearer ${ACCESS}`, `Bearer ${newAccess}`]);
    expect(onCredentialsRefreshed).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: newAccess,
        providerSpecificPatch: { kimiWebSessionSource: sessionSource(pastedRefresh) },
      })
    );
  });
});
