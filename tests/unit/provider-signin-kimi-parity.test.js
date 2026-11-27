import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Kimi sign-in and request parity (#2034).
//
// Source comparison at the pinned revisions:
//   CLIProxyAPI   dbe641f286a489ecb39e3c041c554371e6add864
//   EasyCLIProxyAPI 29567ead8164a00724dfdc2087f02a23895636ee
//   OmniRoute     b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523
//
// Closed network: only the outbound transport, the credential write and the
// connection lookups are substituted. The OAuth route, the shared OAuth
// provider objects, the flow store, the refresh manager, the provider registry
// and the chat core are the real production modules.

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getSyncedModelCatalogs: vi.fn(),
  getEnabledModels: vi.fn(),
  getDisabledModels: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getSyncedModelCatalogs: mocks.getSyncedModelCatalogs,
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: mocks.getEnabledModels }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
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
// The Kimi device grant never opens a browser; the import keeps any browser
// launch module inert.
vi.mock("playwright", () => ({
  chromium: { launch: vi.fn(async () => ({ newContext: vi.fn(async () => ({ newPage: vi.fn() })) })) },
  firefox: { launch: vi.fn() },
  webkit: { launch: vi.fn() },
}));

import { POST } from "@/app/api/oauth/[provider]/[action]/route.js";
import { clearOAuthFlowsForTests } from "@/lib/oauth/flowStore.js";
import { initTranslators } from "open-sse/translator/index.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { PROVIDERS, PROVIDER_MODELS } from "open-sse/providers/index.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import { refreshProviderCredentials, shouldRefreshCredentials } from "open-sse/services/oauthCredentialManager.js";
import { __clearRefreshDedupCacheForTesting } from "open-sse/services/tokenRefresh/dedup.js";
import { __setOriginalFetchForTesting } from "open-sse/utils/proxyFetch.js";
import { LLM_KIND, buildModelsList } from "@/app/api/v1/models/buildModelsList.js";

const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const NOW = 1780000000000;
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() };

// The two Kimi Coding regions. CLIProxyAPI `internal/auth/kimi/kimi.go`
// `ResolveKimiOAuthHost` picks the host from the credential domain.
const REGIONS = [
  { provider: "kimi-coding", other: "kimi-ai", domain: "kimi.com" },
  { provider: "kimi-ai", other: "kimi-coding", domain: "kimi.ai" },
];

async function post(provider, action, body) {
  return POST(new Request(`http://localhost/api/oauth/${provider}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ provider, action }) });
}

describe("Kimi sign-in and request parity (#2034)", () => {
  let outbound;
  let steps;
  let restoreFetch;

  beforeEach(() => {
    clearOAuthFlowsForTests();
    vi.clearAllMocks();
    vi.stubEnv("KIMI_CODING_OAUTH_CLIENT_ID", "");
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    steps = [];
    // Only the transport is substituted: URL, method and body are asserted by
    // the step that answers.
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
    mocks.createProviderConnection.mockImplementation(async (record, { shouldCommit } = {}) => {
      if (shouldCommit) expect(shouldCommit()).toBe(true);
      return { ...record, id: `connection-${record.provider}-${mocks.createProviderConnection.mock.calls.length}` };
    });
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue([]);
    mocks.getSyncedModelCatalogs.mockResolvedValue({});
    mocks.getEnabledModels.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({});
    mocks.resolveConnectionProxyConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    restoreFetch();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __clearRefreshDedupCacheForTesting();
    clearOAuthFlowsForTests();
  });

  describe("Kimi Coding device sign-in (production)", () => {
    it.each(REGIONS)("binds the $domain sign-in, device identity and expiry to one provider", async ({ provider, other, domain }) => {
      const auth = `https://auth.${domain}/api/oauth`;
      const verification = `https://www.${domain}/code/authorize_device`;
      let deviceId;

      steps.push({
        url: `${auth}/device_authorization`,
        respond: ({ body, headers }) => {
          // CLIProxyAPI `RequestDeviceCode`: form-encoded client id only.
          expect(Object.fromEntries(body)).toEqual({ client_id: CLIENT_ID });
          const requestHeaders = new Headers(headers);
          deviceId = requestHeaders.get("x-msh-device-id");
          expect(deviceId).toBeTruthy();
          expect(requestHeaders.get("x-msh-platform")).toBe("DurinDoor");
          expect(requestHeaders.get("x-msh-device-model")).toBeTruthy();
          expect(requestHeaders.get("x-msh-version")).toBeTruthy();
          return Response.json({
            device_code: "private-device-code",
            user_code: "PIN-1234",
            expires_in: 60,
            interval: 5,
            verification_uri: verification,
            verification_uri_complete: `${verification}?user_code=PIN-1234`,
          });
        },
      });

      const started = await post(provider, "device-code", { proxyMode: "direct" });
      expect(started.status).toBe(200);
      const publicPayload = await started.json();
      const { flowId, ...publicFields } = publicPayload;
      expect(publicFields).toEqual({
        expiresAt: NOW + 60000,
        user_code: "PIN-1234",
        verification_uri: verification,
        verification_uri_complete: `${verification}?user_code=PIN-1234`,
        expires_in: 60,
        interval: 5,
      });
      // The private device code never reaches the dashboard.
      expect(JSON.stringify(publicPayload)).not.toContain("private-device-code");

      // A flow belongs to the provider that created it.
      expect((await post(other, "poll", { flowId })).status).toBe(400);
      expect(outbound).toHaveBeenCalledTimes(1);

      const tokenStep = (payload, status) => ({
        url: `${auth}/token`,
        respond: ({ body, headers }) => {
          // CLIProxyAPI `exchangeDeviceCode`: device grant with the same client
          // id and the device code bound to this flow.
          expect(Object.fromEntries(body)).toEqual({
            grant_type: DEVICE_GRANT,
            client_id: CLIENT_ID,
            device_code: "private-device-code",
          });
          expect(new Headers(headers).get("x-msh-device-id")).toBe(deviceId);
          return Response.json(payload, { status });
        },
      });

      // `authorization_pending` and `slow_down` keep the flow open.
      for (const error of ["authorization_pending", "slow_down"]) {
        steps.push(tokenStep({ error, error_description: "waiting" }, 400));
        const pending = await post(provider, "poll", { flowId });
        expect(pending.status).toBe(200);
        expect(await pending.json()).toMatchObject({ success: false, error, pending: true });
      }
      expect(mocks.createProviderConnection).not.toHaveBeenCalled();

      steps.push(tokenStep({ access_token: "sk-kimi-access-1", refresh_token: "sk-kimi-refresh-1", expires_in: 900 }, 200));
      const accepted = await post(provider, "poll", { flowId });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({ success: true, connection: { provider } });

      // A consumed flow cannot submit the same work again.
      const replay = await post(provider, "poll", { flowId });
      expect(replay.status).toBe(410);
      expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);

      const [[record]] = mocks.createProviderConnection.mock.calls;
      expect(record).toMatchObject({
        provider,
        authType: "oauth",
        accessToken: "sk-kimi-access-1",
        refreshToken: "sk-kimi-refresh-1",
        expiresAt: new Date(NOW + 900000).toISOString(),
        providerSpecificData: { deviceId, oauthProxy: { mode: "direct", poolId: null } },
      });

      // The stored expiry drives the refresh decision (CLIProxyAPI
      // `KimiTokenStorage.IsExpired` uses a five minute lead as well).
      expect(shouldRefreshCredentials(provider, record)).toBe(false);
      vi.mocked(Date.now).mockReturnValue(NOW + 601000);
      expect(shouldRefreshCredentials(provider, record)).toBe(true);
    });

    it.each(REGIONS)("closes the $domain flow on a terminal provider error without writing credentials", async ({ provider, domain }) => {
      const auth = `https://auth.${domain}/api/oauth`;
      steps.push({
        url: `${auth}/device_authorization`,
        respond: () => Response.json({
          device_code: "private-device-code",
          user_code: "PIN-1234",
          expires_in: 60,
          verification_uri_complete: `https://www.${domain}/code/authorize_device?user_code=PIN-1234`,
        }),
      }, {
        url: `${auth}/token`,
        respond: () => Response.json({ error: "expired_token" }, { status: 400 }),
      });
      const { flowId } = await (await post(provider, "device-code", { proxyMode: "direct" })).json();
      const polled = await post(provider, "poll", { flowId });
      expect(polled.status).toBe(200);
      expect(await polled.json()).toMatchObject({ success: false, error: "expired_token", pending: false });
      expect(mocks.createProviderConnection).not.toHaveBeenCalled();
      // The terminal reply ends the flow, so a later poll cannot resubmit it.
      expect((await post(provider, "poll", { flowId })).status).toBe(410);
    });

    it("refuses a poll after the flow deadline without any upstream call", async () => {
      steps.push({
        url: "https://auth.kimi.com/api/oauth/device_authorization",
        respond: () => Response.json({
          device_code: "private-device-code",
          user_code: "PIN-1234",
          expires_in: 60,
          verification_uri_complete: "https://www.kimi.com/code/authorize_device?user_code=PIN-1234",
        }),
      });
      const { flowId } = await (await post("kimi-coding", "device-code", { proxyMode: "direct" })).json();
      vi.mocked(Date.now).mockReturnValue(NOW + 60001);
      expect((await post("kimi-coding", "poll", { flowId })).status).toBe(410);
      expect(outbound).toHaveBeenCalledTimes(1);
      expect(mocks.createProviderConnection).not.toHaveBeenCalled();
    });

    it("keeps two concurrent accounts on their own token, client and proxy identity", async () => {
      const auth = "https://auth.kimi.com/api/oauth";
      const deviceIds = [];
      steps.push(
        {
          url: `${auth}/device_authorization`,
          respond: ({ headers }) => {
            deviceIds.push(new Headers(headers).get("x-msh-device-id"));
            return Response.json({
              device_code: "device-a",
              user_code: "PIN-A",
              expires_in: 600,
              verification_uri_complete: "https://www.kimi.com/code/authorize_device?user_code=PIN-A",
            });
          },
        },
        {
          url: `${auth}/device_authorization`,
          respond: ({ headers }) => {
            deviceIds.push(new Headers(headers).get("x-msh-device-id"));
            return Response.json({
              device_code: "device-b",
              user_code: "PIN-B",
              expires_in: 600,
              verification_uri_complete: "https://www.kimi.com/code/authorize_device?user_code=PIN-B",
            });
          },
        },
      );
      const first = await (await post("kimi-coding", "device-code", { proxyMode: "direct" })).json();
      const second = await (await post("kimi-coding", "device-code", { proxyMode: "legacy" })).json();
      expect(first.flowId).not.toBe(second.flowId);
      expect(deviceIds[0]).not.toBe(deviceIds[1]);

      const tokenStep = (deviceCode, accessToken, expectedDeviceId) => ({
        url: `${auth}/token`,
        respond: ({ body, headers }) => {
          expect(body.get("device_code")).toBe(deviceCode);
          // Each poll presents the device identity bound to its own flow.
          expect(new Headers(headers).get("x-msh-device-id")).toBe(expectedDeviceId);
          return Response.json({ access_token: accessToken, refresh_token: `${accessToken}-refresh`, expires_in: 900 });
        },
      });
      // The second flow is polled first: each poll must use its own device code
      // and device identity.
      steps.push(
        tokenStep("device-b", "sk-kimi-access-b", deviceIds[1]),
        tokenStep("device-a", "sk-kimi-access-a", deviceIds[0])
      );
      await post("kimi-coding", "poll", { flowId: second.flowId });
      await post("kimi-coding", "poll", { flowId: first.flowId });

      const records = mocks.createProviderConnection.mock.calls.map(([record]) => record);
      expect(records).toHaveLength(2);
      expect(records.map((record) => record.accessToken).sort()).toEqual(["sk-kimi-access-a", "sk-kimi-access-b"]);
      expect(records[0].providerSpecificData.deviceId).not.toBe(records[1].providerSpecificData.deviceId);
      expect(records[0].providerSpecificData.oauthProxy).toEqual({ mode: "legacy", poolId: null });
      expect(records[1].providerSpecificData.oauthProxy).toEqual({ mode: "direct", poolId: null });
    });

    it("never relays an upstream secret or the device code to the caller", async () => {
      const auth = "https://auth.kimi.com/api/oauth";
      steps.push({
        url: `${auth}/device_authorization`,
        respond: () => Response.json({
          device_code: "private-device-code",
          user_code: "PIN-1234",
          expires_in: 60,
          verification_uri_complete: "https://www.kimi.com/code/authorize_device?user_code=PIN-1234",
        }),
      }, {
        url: `${auth}/token`,
        respond: () => Response.json({
          error: "server_error",
          message: "upstream rejected access_token sk-kimi-secret-value-0123456789",
        }, { status: 500 }),
      });
      const { flowId } = await (await post("kimi-coding", "device-code", { proxyMode: "direct" })).json();
      const polled = await post("kimi-coding", "poll", { flowId });
      const payload = await polled.json();
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("sk-kimi-secret-value-0123456789");
      expect(serialized).not.toContain("private-device-code");
      expect(payload).toMatchObject({ success: false, error: "server_error" });
      expect(mocks.createProviderConnection).not.toHaveBeenCalled();
    });

    it("refuses the Kimi identities that do not own a device grant before any network call", async () => {
      // The Moonshot platform key, the Kimi consumer web session and the Kimi
      // Code API key are not OAuth device providers at all.
      for (const provider of ["kimi", "kimi-web", "kimi-coding-apikey"]) {
        const response = await post(provider, "device-code", { proxyMode: "direct" });
        expect(response.status, provider).toBe(400);
        expect((await response.json()).error, provider).toBe("Unsupported OAuth provider");
      }
      // Kimchi is a separate browser-login provider, not a Kimi Coding
      // equivalent: it is registered for OAuth but offers no device grant.
      const kimchi = await post("kimchi", "device-code", { proxyMode: "direct" });
      expect(kimchi.status).toBe(400);
      expect((await kimchi.json()).error).toBe("Provider does not support device code flow");
      expect(outbound).not.toHaveBeenCalled();
      expect(mocks.createProviderConnection).not.toHaveBeenCalled();
    });
  });

  describe("Kimi Coding refresh (production)", () => {
    it.each(REGIONS)("refreshes the $domain token with the stored device identity", async ({ provider, domain }) => {
      const auth = `https://auth.${domain}/api/oauth`;
      let deviceId;
      steps.push({
        url: `${auth}/device_authorization`,
        respond: ({ headers }) => {
          deviceId = new Headers(headers).get("x-msh-device-id");
          return Response.json({
            device_code: "private-device-code",
            user_code: "PIN-1234",
            expires_in: 60,
            verification_uri_complete: `https://www.${domain}/code/authorize_device?user_code=PIN-1234`,
          });
        },
      });
      const { flowId } = await (await post(provider, "device-code", { proxyMode: "direct" })).json();
      steps.push({
        url: `${auth}/token`,
        respond: () => Response.json({ access_token: "sk-kimi-access-1", refresh_token: "sk-kimi-refresh-1", expires_in: 900 }),
      });
      await post(provider, "poll", { flowId });
      const [[record]] = mocks.createProviderConnection.mock.calls;

      // CLIProxyAPI `refreshTokenSingleFlight` and OmniRoute `kimiCoding.ts`
      // send the same form grant with the stored device identity.
      steps.push({
        url: `${auth}/token`,
        respond: ({ body, headers }) => {
          expect(Object.fromEntries(body)).toEqual({
            grant_type: "refresh_token",
            client_id: CLIENT_ID,
            refresh_token: "sk-kimi-refresh-1",
          });
          expect(new Headers(headers).get("x-msh-device-id")).toBe(deviceId);
          return Response.json({ access_token: "sk-kimi-access-2", refresh_token: "sk-kimi-refresh-2", expires_in: 900 });
        },
      });
      const refreshed = await refreshProviderCredentials(provider, record, log);
      expect(refreshed).toMatchObject({
        accessToken: "sk-kimi-access-2",
        refreshToken: "sk-kimi-refresh-2",
        expiresIn: 900,
      });
      expect(steps).toEqual([]);
    });

    it.each(REGIONS)("keeps the stored refresh token when the $domain provider omits a replacement", async ({ provider, domain }) => {
      const auth = `https://auth.${domain}/api/oauth`;
      steps.push({
        url: `${auth}/token`,
        respond: ({ body }) => {
          expect(body.get("refresh_token")).toBe("sk-kimi-refresh-1");
          return Response.json({ access_token: "sk-kimi-access-2", expires_in: 900 });
        },
      });
      const refreshed = await getExecutor(provider).refreshCredentials(
        { refreshToken: "sk-kimi-refresh-1", providerSpecificData: { deviceId: "11111111-2222-3333-4444-555555555555" } },
        log,
        { disableEnvProxy: true },
      );
      expect(refreshed).toEqual({
        accessToken: "sk-kimi-access-2",
        refreshToken: "sk-kimi-refresh-1",
        expiresIn: 900,
      });
    });

    it.each(REGIONS)("reports a rejected $domain refresh token as unrecoverable", async ({ provider, domain }) => {
      const auth = `https://auth.${domain}/api/oauth`;
      steps.push({
        url: `${auth}/token`,
        respond: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
      });
      const refreshed = await getExecutor(provider).refreshCredentials(
        { refreshToken: "sk-kimi-refresh-1", providerSpecificData: { deviceId: "11111111-2222-3333-4444-555555555555" } },
        log,
        { disableEnvProxy: true },
      );
      expect(refreshed).toEqual({ error: "unrecoverable_refresh_error", code: "invalid_grant" });
    });

    it("still identifies the device when a connection carries no stored device id", async () => {
      steps.push({
        url: "https://auth.kimi.com/api/oauth/token",
        respond: ({ headers }) => {
          const deviceId = new Headers(headers).get("x-msh-device-id");
          expect(deviceId).toBeTruthy();
          return Response.json({ access_token: "sk-kimi-access-2", expires_in: 900 });
        },
      });
      const refreshed = await getExecutor("kimi-coding").refreshCredentials(
        { refreshToken: "sk-kimi-refresh-1" },
        log,
        { disableEnvProxy: true },
      );
      expect(refreshed).toMatchObject({ accessToken: "sk-kimi-access-2" });
    });
  });

  describe("Kimi request and stream translation (production)", () => {
    beforeEach(async () => {
      await initTranslators();
    });

    it("serves the .com Coding transport over the native Anthropic wire", async () => {
      const body = {
        model: "kmc/k3",
        max_tokens: 100,
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      };
      steps.push({
        url: "https://api.kimi.com/coding/v1/messages/count_tokens",
        respond: ({ headers }) => {
          expect(new Headers(headers).get("x-api-key")).toBe("sk-kimi-existing-access");
          return new Response(null, { status: 404 });
        },
      }, {
        url: "https://api.kimi.com/coding/v1/messages",
        respond: ({ body: wireBody, headers }) => {
          const auth = new Headers(headers);
          expect(auth.get("x-api-key")).toBe("sk-kimi-existing-access");
          expect(auth.has("authorization")).toBe(false);
          expect(auth.get("x-msh-device-id")).toBe("sk-kimi-device");
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
          accessToken: "sk-kimi-existing-access",
          providerSpecificData: { deviceId: "sk-kimi-device", oauthProxy: { mode: "direct", poolId: null } },
        },
        sourceFormatOverride: "claude",
        clientRawRequest: { endpoint: "/v1/messages", body, headers: { accept: "application/json" } },
        connectionId: "connection-kimi-coding",
        log,
      });
      expect(result.success, result.success ? undefined : await result.response.text()).toBe(true);
      expect(await result.response.json()).toMatchObject({
        type: "message", role: "assistant", content: [{ type: "text", text: "Hello back" }],
      });
      expect(outbound).toHaveBeenCalledTimes(2);
      expect(steps).toEqual([]);
    });

    it("translates Anthropic Messages to the .ai Coding Chat wire and back", async () => {
      const body = {
        model: "kimi.ai/k3",
        max_tokens: 100,
        messages: [{ role: "user", content: "Hello" }],
      };
      steps.push({
        url: "https://api.kimi.ai/coding/v1/chat/completions",
        respond: ({ body: wireBody, headers }) => {
          const auth = new Headers(headers);
          expect(auth.get("authorization")).toBe("Bearer sk-kimi-regional-access");
          expect(auth.has("x-api-key")).toBe(false);
          expect(auth.get("x-msh-device-id")).toBe("sk-kimi-regional-device");
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
          accessToken: "sk-kimi-regional-access",
          providerSpecificData: { deviceId: "sk-kimi-regional-device", oauthProxy: { mode: "direct", poolId: null } },
        },
        sourceFormatOverride: "claude",
        clientRawRequest: { endpoint: "/v1/messages", body, headers: { accept: "application/json" } },
        connectionId: "connection-kimi-ai",
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

  describe("Kimi model discovery (production)", () => {
    it("serves the Coding catalog and keeps the other Kimi identities apart", async () => {
      mocks.getProviderConnections.mockResolvedValue([{
        id: "kimi-coding-connection",
        provider: "kimi-coding",
        authType: "oauth",
        accessToken: "sk-kimi-access",
        isActive: true,
        providerSpecificData: {},
      }]);
      const models = await buildModelsList([LLM_KIND]);
      const ids = models.map((model) => model.id);
      expect(ids).toContain("kmc/k3");
      expect(ids).toContain("kmc/k3.1-pro");
      // The Moonshot platform key and the Kimi Code API key are different
      // providers with different catalogs.
      expect(PROVIDER_MODELS["kimi"].map((model) => model.id)).toContain("kimi-k3.1-pro");
      expect(PROVIDER_MODELS["kmc"].map((model) => model.id)).toEqual(
        expect.arrayContaining(["k3", "k3.1-pro", "kimi-for-coding"])
      );
      expect(PROVIDER_MODELS["kmc"]).not.toContain(
        expect.objectContaining({ id: "kimi-k3.1-pro" })
      );
      expect(resolveProviderAlias("kimi")).toBe("kimi");
      expect(resolveProviderAlias("kmc")).toBe("kimi-coding");
      expect(resolveProviderAlias("kimi.ai")).toBe("kimi-ai");
      expect(resolveProviderAlias("kimi-web")).toBe("kimi-web");
    });
  });

  // Staging-only assertions. This block covers the helper that the ordered
  // auth batches will wire into the shared OAuth files; it is kept apart from
  // the production contracts above so the protocol, security and usage cases
  // never depend on staged code.
  describe("Staged Kimi device identity helper (#2034 staging)", () => {
    it("builds the identity header set both upstreams send", async () => {
      const {
        buildKimiDeviceIdentityHeaders,
        getKimiDeviceFacts,
      } = await import("@/lib/oauth/providerParity/kimi/index.js");
      const headers = buildKimiDeviceIdentityHeaders({
        platform: "DurinDoor",
        version: "4.11.0",
        deviceId: "11111111-2222-3333-4444-555555555555",
      });
      expect(Object.keys(headers).sort()).toEqual([
        "X-Msh-Device-Id",
        "X-Msh-Device-Model",
        "X-Msh-Device-Name",
        "X-Msh-Os-Version",
        "X-Msh-Platform",
        "X-Msh-Version",
      ]);
      expect(headers["X-Msh-Platform"]).toBe("DurinDoor");
      expect(headers["X-Msh-Version"]).toBe("4.11.0");
      expect(headers["X-Msh-Device-Id"]).toBe("11111111-2222-3333-4444-555555555555");
      const facts = getKimiDeviceFacts();
      expect(headers["X-Msh-Device-Name"]).toBe(facts.deviceName);
      expect(headers["X-Msh-Device-Model"]).toBe(facts.deviceModel);
      expect(headers["X-Msh-Os-Version"]).toBe(facts.osVersion);
      for (const value of Object.values(headers)) {
        expect(value).toMatch(/^[\x20-\x7e]+$/);
      }
    });

    it("sanitizes header values and normalizes a bare device id", async () => {
      const {
        normalizeKimiDeviceId,
        sanitizeKimiHeaderValue,
      } = await import("@/lib/oauth/providerParity/kimi/index.js");
      expect(sanitizeKimiHeaderValue("host\nname")).toBe("hostname");
      expect(sanitizeKimiHeaderValue("  ")).toBe("unknown");
      expect(sanitizeKimiHeaderValue("", "fallback")).toBe("fallback");
      expect(normalizeKimiDeviceId("11111111222233334444555555555555"))
        .toBe("11111111-2222-3333-4444-555555555555");
      expect(normalizeKimiDeviceId("  ")).toBe("");
      expect(normalizeKimiDeviceId("already-a-uuid")).toBe("already-a-uuid");
    });

    it("keeps one device across refreshes of the same token", async () => {
      const {
        deriveKimiDeviceIdFromRefreshToken,
        resolveKimiDeviceId,
      } = await import("@/lib/oauth/providerParity/kimi/index.js");
      const derived = deriveKimiDeviceIdFromRefreshToken("sk-kimi-refresh-1");
      // OmniRoute `open-sse/services/tokenRefresh/providers/kimiCoding.ts`:
      // pbkdf2Sync(refreshToken, "kimi-device-id", 1000, 16, "sha256"), grouped
      // as a UUID by `normalizeKimiDeviceId`.
      expect(derived).toBe("b626e452-94bb-a899-2d02-6bf79b903219");
      expect(derived).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(deriveKimiDeviceIdFromRefreshToken("sk-kimi-refresh-1")).toBe(derived);
      expect(deriveKimiDeviceIdFromRefreshToken("sk-kimi-refresh-2")).not.toBe(derived);
      expect(deriveKimiDeviceIdFromRefreshToken("")).toBe("");
      // The stored identity wins, the refresh token is the fallback, and a
      // connection with neither still gets a fresh UUID.
      expect(resolveKimiDeviceId({ deviceId: "stored-device", refreshToken: "sk-kimi-refresh-1" })).toBe("stored-device");
      expect(resolveKimiDeviceId({ refreshToken: "sk-kimi-refresh-1" })).toBe(derived);
      expect(resolveKimiDeviceId({})).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("refuses a provider that does not own a Kimi Coding device credential", async () => {
      const { isKimiCodingProvider, resolveKimiOAuthRegion } =
        await import("@/lib/oauth/providerParity/kimi/index.js");
      expect(isKimiCodingProvider("kimi-coding")).toBe(true);
      expect(isKimiCodingProvider("kimi-ai")).toBe(true);
      for (const provider of ["kimi", "kimi-web", "kimi-coding-apikey", "kimchi", ""]) {
        expect(isKimiCodingProvider(provider), provider).toBe(false);
        expect(() => resolveKimiOAuthRegion(provider), provider).toThrow(/Unsupported Kimi OAuth provider/);
      }
      expect(resolveKimiOAuthRegion("kimi-ai")).toMatchObject({
        domain: "kimi.ai",
        deviceCodeUrl: "https://auth.kimi.ai/api/oauth/device_authorization",
        tokenUrl: "https://auth.kimi.ai/api/oauth/token",
      });
    });

    it("matches the pinned upstream endpoints and grants", async () => {
      const {
        KIMI_CODING_CLIENT_ID,
        KIMI_DEVICE_PENDING_ERRORS,
        KIMI_DEVICE_TERMINAL_ERRORS,
        KIMI_OAUTH_GRANT_DEVICE,
        KIMI_OAUTH_GRANT_REFRESH,
        KIMI_OAUTH_REGIONS,
      } = await import("@/lib/oauth/providerParity/kimi/index.js");
      expect(KIMI_CODING_CLIENT_ID).toBe(CLIENT_ID);
      expect(KIMI_OAUTH_GRANT_DEVICE).toBe(DEVICE_GRANT);
      expect(KIMI_OAUTH_GRANT_REFRESH).toBe("refresh_token");
      expect(KIMI_DEVICE_PENDING_ERRORS).toEqual(["authorization_pending", "slow_down"]);
      expect(KIMI_DEVICE_TERMINAL_ERRORS).toEqual(["expired_token", "access_denied"]);
      expect(Object.keys(KIMI_OAUTH_REGIONS)).toEqual(["kimi-coding", "kimi-ai"]);
      expect(KIMI_OAUTH_REGIONS["kimi-coding"]).toMatchObject({
        deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
        tokenUrl: "https://auth.kimi.com/api/oauth/token",
      });
    });
  });
});
