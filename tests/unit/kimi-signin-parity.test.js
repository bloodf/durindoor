import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createProviderConnection } = vi.hoisted(() => ({ createProviderConnection: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection }));
vi.mock("@/lib/network/initOutboundProxy", () => ({
  ensureOutboundProxyInitialized: async () => {},
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

import { POST } from "@/app/api/oauth/[provider]/[action]/route.js";
import { clearOAuthFlowsForTests } from "@/lib/oauth/flowStore.js";
import { initTranslators } from "open-sse/translator/index.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { PROVIDERS } from "open-sse/providers/index.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import { refreshProviderCredentials, shouldRefreshCredentials } from "open-sse/services/oauthCredentialManager.js";
import { __clearRefreshDedupCacheForTesting } from "open-sse/services/tokenRefresh/dedup.js";
import { __setOriginalFetchForTesting } from "open-sse/utils/proxyFetch.js";

const clientId = "17e5f671-d194-4dfb-9706-5516cb48c098";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() };

async function post(provider, action, body) {
  return POST(new Request(`http://localhost/api/oauth/${provider}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ provider, action }) });
}

const regions = [
  { provider: "kimi-coding", other: "kimi-ai", domain: "kimi.com" },
  { provider: "kimi-ai", other: "kimi-coding", domain: "kimi.ai" },
];

describe("Kimi device sign-in and Anthropic compatibility", () => {
  let outbound;
  let steps;
  let restoreFetch;

  beforeEach(() => {
    clearOAuthFlowsForTests();
    vi.clearAllMocks();
    vi.stubEnv("KIMI_CODING_OAUTH_CLIENT_ID", "");
    vi.spyOn(Date, "now").mockReturnValue(1780000000000);
    steps = [];
    outbound = vi.fn(async (url, options) => {
      const step = steps[0];
      if (!step) throw new Error(`Unexpected outbound request to ${url}`);
      expect(String(url)).toBe(step.url);
      expect(options.method).toBe("POST");
      const response = await step.respond(options);
      steps.shift();
      return response;
    });
    restoreFetch = __setOriginalFetchForTesting(outbound);
    createProviderConnection.mockImplementation(async (record, { shouldCommit }) => {
      expect(shouldCommit()).toBe(true);
      return { ...record, id: `connection-${record.provider}` };
    });
  });

  afterEach(() => {
    restoreFetch();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __clearRefreshDedupCacheForTesting();
    clearOAuthFlowsForTests();
  });

  it.each(regions)("binds $domain sign-in, expiry and refresh to one provider", async ({ provider, other, domain }) => {
    const auth = `https://auth.${domain}/api/oauth`;
    const verification = `https://www.${domain}/code/authorize_device`;
    let deviceId;
    const startResponse = ({ body, headers }) => {
      expect(Object.fromEntries(body)).toEqual({ client_id: clientId });
      deviceId = new Headers(headers).get("x-msh-device-id");
      expect(deviceId).toBeTruthy();
      return Response.json({
        device_code: "private-code", user_code: "PIN", expires_in: 60,
        ...(domain === "kimi.ai" && {
          verification_uri: verification,
          verification_uri_complete: `${verification}?user_code=PIN`,
        }),
      });
    };
    steps.push({ url: `${auth}/device_authorization`, respond: startResponse });

    const started = await post(provider, "device-code", { proxyMode: "direct" });
    expect(started.status).toBe(200);
    const { flowId, ...publicFields } = await started.json();
    expect(publicFields).toEqual({
      expiresAt: Date.now() + 60000,
      user_code: "PIN",
      verification_uri: verification,
      verification_uri_complete: `${verification}?user_code=PIN`,
      expires_in: 60,
      interval: 5,
    });

    expect((await post(other, "poll", { flowId })).status).toBe(400);
    expect(outbound).toHaveBeenCalledTimes(1);

    const pollReply = (payload, status) => ({
      url: `${auth}/token`,
      respond: ({ body, headers }) => {
        expect(Object.fromEntries(body)).toEqual({
          grant_type: deviceGrant, client_id: clientId, device_code: "private-code",
        });
        expect(new Headers(headers).get("x-msh-device-id")).toBe(deviceId);
        return Response.json(payload, { status });
      },
    });
    for (const error of ["authorization_pending", "slow_down"]) {
      steps.push(pollReply({ error }, 400));
      const pending = await post(provider, "poll", { flowId, deviceCode: "ignored-code" });
      expect(await pending.json()).toMatchObject({ success: false, error, pending: true });
    }
    expect(createProviderConnection).not.toHaveBeenCalled();

    steps.push(pollReply({ access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 900 }, 200));
    expect(await (await post(provider, "poll", { flowId })).json()).toEqual({
      success: true, connection: { id: `connection-${provider}`, provider },
    });
    expect((await post(provider, "poll", { flowId })).status).toBe(410);

    const [[record]] = createProviderConnection.mock.calls;
    expect(record).toMatchObject({
      provider, authType: "oauth", accessToken: "fake-access", refreshToken: "fake-refresh",
      expiresAt: new Date(Date.now() + 900000).toISOString(),
      providerSpecificData: { deviceId, oauthProxy: { mode: "direct", poolId: null } },
    });
    expect(shouldRefreshCredentials(provider, record)).toBe(false);
    vi.mocked(Date.now).mockReturnValue(Date.now() + 601000);
    expect(shouldRefreshCredentials(provider, record)).toBe(true);

    for (const [oldToken, newToken] of [["fake-refresh", "rotated-refresh"], ["rotated-refresh", undefined]]) {
      steps.push({
        url: `${auth}/token`,
        respond: ({ body, headers }) => {
          expect(Object.fromEntries(body)).toEqual({
            grant_type: "refresh_token", client_id: clientId, refresh_token: oldToken,
          });
          expect(new Headers(headers).get("x-msh-device-id")).toBe(deviceId);
          return Response.json({ access_token: "refreshed-access", refresh_token: newToken, expires_in: 600 });
        },
      });
      const credentials = { ...record, refreshToken: oldToken };
      const refreshed = newToken
        ? await refreshProviderCredentials(provider, credentials, log)
        : await getExecutor(provider).refreshCredentials(credentials, log, { disableEnvProxy: true });
      expect(refreshed).toMatchObject({
        accessToken: "refreshed-access", refreshToken: newToken ?? oldToken, expiresIn: 600,
      });
    }

    steps.push({ url: `${auth}/device_authorization`, respond: startResponse });
    const expiring = await (await post(provider, "device-code", { proxyMode: "direct" })).json();
    vi.mocked(Date.now).mockReturnValue(expiring.expiresAt + 1);
    expect((await post(provider, "poll", { flowId: expiring.flowId })).status).toBe(410);
    expect(createProviderConnection).toHaveBeenCalledTimes(1);
    expect(outbound).toHaveBeenCalledTimes(7);
    expect(steps).toEqual([]);
  });

  describe.each(regions)("$domain token responses", ({ provider, domain }) => {
    async function startPoll(payload, status = 200) {
      const auth = `https://auth.${domain}/api/oauth`;
      steps.push({
        url: `${auth}/device_authorization`,
        respond: () => Response.json({
          device_code: "private-code", user_code: "PIN", expires_in: 60,
          verification_uri_complete: `https://www.${domain}/code/authorize_device?user_code=PIN`,
        }),
      }, {
        url: `${auth}/token`,
        respond: () => Response.json(payload, { status }),
      });
      const started = await post(provider, "device-code", { proxyMode: "direct" });
      expect(started.status).toBe(200);
      const { flowId } = await started.json();
      const polled = await post(provider, "poll", { flowId });
      expect(polled.status).toBe(200);
      expect(steps).toEqual([]);
      return polled.json();
    }

    it.each([
      ["object access and array refresh", { access_token: {}, refresh_token: [] }],
      ["missing access", { refresh_token: "fake-refresh" }],
      ["empty access", { access_token: "" }],
      ["blank access", { access_token: " " }],
      ["array refresh", { access_token: "fake-access", refresh_token: [] }],
      ["null refresh", { access_token: "fake-access", refresh_token: null }],
      ["empty refresh", { access_token: "fake-access", refresh_token: "" }],
      ["blank refresh", { access_token: "fake-access", refresh_token: " " }],
    ])("rejects %s before saving credentials", async (_label, payload) => {
      const result = await startPoll(payload);
      expect(createProviderConnection).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false, error: "invalid_response", errorDescription: "Invalid Kimi token response", pending: false,
      });
    });

    it.each([
      [200, { error: "authorization_pending", message: "Still waiting" }, "Still waiting", true],
      [400, { error: "access_denied", error_description: "Authorization denied" }, "Authorization denied", false],
    ])("preserves HTTP %i provider errors", async (status, payload, errorDescription, pending) => {
      expect(await startPoll(payload, status)).toEqual({
        success: false, error: payload.error, errorDescription, pending,
      });
      expect(createProviderConnection).not.toHaveBeenCalled();
    });

    it("saves a valid access token with an omitted refresh token", async () => {
      expect(await startPoll({ access_token: "fake-access" })).toEqual({
        success: true, connection: { id: `connection-${provider}`, provider },
      });
      expect(createProviderConnection).toHaveBeenCalledTimes(1);
      const [[record]] = createProviderConnection.mock.calls;
      expect(record.accessToken).toBe("fake-access");
      expect(record.refreshToken).toBeUndefined();
    });
  });

  it("keeps platform keys and the existing Coding identity separate", () => {
    expect(resolveProviderAlias("kimi")).toBe("kimi");
    expect(resolveProviderAlias("kmc")).toBe("kimi-coding");
    expect(resolveProviderAlias("kmca")).toBe("kimi-coding-apikey");
    expect(resolveProviderAlias("kimi.ai")).toBe("kimi-ai");
    expect(resolveProviderAlias("kimi.com")).toBe("kimi-coding");
    expect(PROVIDERS.kimi.baseUrl).toBe("https://api.moonshot.ai/anthropic/v1/messages");
  });

  it("keeps the configured Coding client ID through sign-in and refresh of a legacy connection", async () => {
    vi.stubEnv("KIMI_CODING_OAUTH_CLIENT_ID", "fake-client-override");
    const auth = "https://auth.kimi.com/api/oauth";
    steps.push({
      url: `${auth}/device_authorization`,
      respond: ({ body }) => {
        expect(body.get("client_id")).toBe("fake-client-override");
        return Response.json({ device_code: "fake-device-code", user_code: "PIN", expires_in: 60 });
      },
    }, {
      url: `${auth}/token`,
      respond: ({ body }) => {
        expect(body.get("client_id")).toBe("fake-client-override");
        return Response.json({ access_token: "refreshed-access", expires_in: 600 });
      },
    });
    expect((await post("kimi-coding", "device-code", { proxyMode: "direct" })).status).toBe(200);
    expect(await getExecutor("kimi-coding").refreshCredentials(
      { refreshToken: "legacy-fake-refresh" }, log, { disableEnvProxy: true },
    )).toEqual({ accessToken: "refreshed-access", refreshToken: "legacy-fake-refresh", expiresIn: 600 });
    expect(steps).toEqual([]);
  });

  it("keeps existing Coding requests on the native Anthropic transport", async () => {
    await initTranslators();
    const body = {
      model: "kmc/k3",
      max_tokens: 100,
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    steps.push({
      url: "https://api.kimi.com/coding/v1/messages/count_tokens",
      respond: ({ headers }) => {
        expect(new Headers(headers).get("x-api-key")).toBe("fake-existing-access");
        return new Response(null, { status: 404 });
      },
    }, {
      url: "https://api.kimi.com/coding/v1/messages",
      respond: ({ body: wireBody, headers }) => {
        const auth = new Headers(headers);
        expect(auth.get("x-api-key")).toBe("fake-existing-access");
        expect(auth.has("authorization")).toBe(false);
        expect(auth.get("anthropic-version")).toBeTruthy();
        expect(JSON.parse(wireBody)).toMatchObject({ model: "k3", messages: body.messages });
        const events = [
          { type: "message_start", message: { id: "mock-message", type: "message", role: "assistant", model: "k3", content: [], usage: { input_tokens: 3, output_tokens: 0 } } },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello back" } },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
          { type: "message_stop" },
        ];
        return new Response(events.map((event) =>
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
        ).join(""), { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    const result = await handleChatCore({
      body,
      modelInfo: { provider: resolveProviderAlias("kmc"), model: "k3" },
      credentials: {
        accessToken: "fake-existing-access",
        providerSpecificData: { oauthProxy: { mode: "direct", poolId: null } },
      },
      sourceFormatOverride: "claude",
      clientRawRequest: { endpoint: "/v1/messages", body, headers: { accept: "application/json" } },
      connectionId: "existing-connection",
      log,
    });
    expect(result.success, result.success ? undefined : await result.response.text()).toBe(true);
    expect(await result.response.json()).toMatchObject({
      type: "message", role: "assistant", content: [{ type: "text", text: "Hello back" }],
    });
    expect(outbound).toHaveBeenCalledTimes(2);
    expect(steps).toEqual([]);
  });

  it("translates Anthropic Messages to regional Coding Chat Completions and back", async () => {
    await initTranslators();
    const body = {
      model: "kimi.ai/k3",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hello" }],
    };
    steps.push({
      url: "https://api.kimi.ai/coding/v1/chat/completions",
      respond: ({ body: wireBody, headers }) => {
        expect(new Headers(headers).get("authorization")).toBe("Bearer fake-regional-access");
        expect(new Headers(headers).has("x-api-key")).toBe(false);
        expect(new Headers(headers).get("x-msh-device-id")).toBe("fake-device");
        expect(new Headers(headers).get("x-msh-platform")).toBe("DurinDoor");
        expect(JSON.parse(wireBody)).toMatchObject({
          model: "k3",
          messages: [{ role: "user", content: "Hello" }],
        });
        return Response.json({
          id: "mock-completion", object: "chat.completion", model: "k3",
          choices: [{ index: 0, message: { role: "assistant", content: "Hello back" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        });
      },
    });
    const result = await handleChatCore({
      body,
      modelInfo: { provider: resolveProviderAlias("kimi.ai"), model: "k3" },
      credentials: {
        accessToken: "fake-regional-access",
        providerSpecificData: { deviceId: "fake-device", oauthProxy: { mode: "direct", poolId: null } },
      },
      sourceFormatOverride: "claude",
      clientRawRequest: { endpoint: "/v1/messages", body, headers: { accept: "application/json" } },
      connectionId: "regional-connection",
      log,
    });
    expect(result.success, result.success ? undefined : await result.response.text()).toBe(true);
    expect(await result.response.json()).toMatchObject({
      type: "message", role: "assistant", content: [{ type: "text", text: "Hello back" }],
    });
    expect(outbound).toHaveBeenCalledTimes(1);
    expect(steps).toEqual([]);
  });
});
