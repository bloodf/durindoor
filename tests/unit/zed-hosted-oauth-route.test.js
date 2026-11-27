// Zed native callback through the real OAuth route and adapter; only persistence/transport are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  exchangeTokens: vi.fn(),
  generateAuthData: vi.fn(),
  getProvider: vi.fn(),
  pollForToken: vi.fn(),
  requestDeviceCode: vi.fn(),
  getProxyPoolById: vi.fn(),
  clearCodexSession: vi.fn(),
  clearXaiSession: vi.fn(),
  getCodexSessionStatus: vi.fn(),
  getXaiSessionStatus: vi.fn(),
  startCodexProxy: vi.fn(),
  stopCodexProxy: vi.fn(),
  stopXaiProxy: vi.fn(),
  registerCodexSession: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({
  ensureOutboundProxyInitialized: mocks.ensureOutboundProxyInitialized,
}));
vi.mock("@/lib/localDb", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProxyPoolById: mocks.getProxyPoolById,
}));
vi.mock("@/lib/oauth/providers.js", () => ({
  exchangeTokens: mocks.exchangeTokens,
  extractCodexAccountInfo: () => ({}),
  generateAuthData: mocks.generateAuthData,
  getProvider: mocks.getProvider,
  pollForToken: mocks.pollForToken,
  requestDeviceCode: mocks.requestDeviceCode,
}));
vi.mock("@/lib/oauth/utils/server", () => ({
  clearCodexSession: mocks.clearCodexSession,
  clearXaiSession: mocks.clearXaiSession,
  getCodexSessionStatus: mocks.getCodexSessionStatus,
  getXaiSessionStatus: mocks.getXaiSessionStatus,
  registerCodexSession: mocks.registerCodexSession,
  registerXaiSession: vi.fn(),
  startCodexProxy: mocks.startCodexProxy,
  startXaiProxy: vi.fn(),
  stopCodexProxy: mocks.stopCodexProxy,
  stopXaiProxy: mocks.stopXaiProxy,
}));

import {
  claimOAuthFlow,
  clearOAuthFlowsForTests,
  getOAuthFlow,
} from "@/lib/oauth/flowStore.js";

function request(body) {
  return { json: async () => body };
}

async function post(provider, action, body) {
  const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
  return POST(request(body), { params: Promise.resolve({ provider, action }) });
}

async function get(provider, action, query = "") {
  const { GET } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
  return GET(new Request(`http://localhost/api/oauth/${provider}/${action}${query}`), {
    params: Promise.resolve({ provider, action }),
  });
}


import crypto from "node:crypto";
import { zedHosted } from "../../src/lib/oauth/zedHostedProvider.js";
const profile = vi.fn(async () => new Response('{"default_organization_id":"org"}'));
let generated;
beforeEach(() => {
  clearOAuthFlowsForTests();
  vi.clearAllMocks();
  mocks.getProvider.mockReturnValue(zedHosted);
  mocks.ensureOutboundProxyInitialized.mockResolvedValue();
  mocks.generateAuthData.mockImplementation(async (_provider, redirectUri) => {
    const data = zedHosted.buildAuthUrl(zedHosted.config, redirectUri);
    generated = { ...data, state: crypto.randomUUID(), flowType: "authorization_code", meta: { systemId: data.systemId } };
    return generated;
  });
  mocks.exchangeTokens.mockImplementation(async (_provider, code, redirectUri, verifier, state, meta, proxyOptions) =>
    zedHosted.mapTokens(await zedHosted.exchangeToken(zedHosted.config, code, redirectUri, verifier, state, { ...meta, fetch: profile }, proxyOptions)));
  mocks.createProviderConnection.mockImplementation(async (data, options) => {
    expect(options.shouldCommit()).toBe(true);
    return { id: "selected-zed-account", ...data };
  });
});
afterEach(() => vi.restoreAllMocks());
const authorize = (ownerId = "browser-a") => post("zed-hosted", "authorize", { redirectUri: "http://127.0.0.1:3000/callback", proxyMode: "direct", ownerId });
function sealedCallback(auth) {
  const key = crypto.createPublicKey({ key: Buffer.from(new URL(auth.authUrl).searchParams.get("native_app_public_key"), "base64url"), format: "der", type: "pkcs1" });
  const sealed = crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from("synthetic-zed-access"));
  return `user_id=selected-user&access_token=${sealed.toString("base64url")}`;
}
it("owns the RSA verifier server-side, rejects wrong state and prevents callback replay", async () => {
  const auth = await authorize();
  expect(auth.status).toBe(200);
  expect(auth.body).not.toHaveProperty("codeVerifier");
  const code = sealedCallback(generated);
  const input = { flowId: auth.body.flowId, state: generated.state, code, codeVerifier: "attacker-value" };
  expect((await post("zed-hosted", "exchange", { ...input, state: "wrong-state" })).status).not.toBe(200);
  expect(profile).not.toHaveBeenCalled();
  const result = await post("zed-hosted", "exchange", input);
  expect(result.status).toBe(200);
  expect(mocks.createProviderConnection.mock.calls[0][0]).toMatchObject({ accessToken: "synthetic-zed-access", providerSpecificData: { userId: "selected-user", systemId: generated.systemId } });
  expect((await post("zed-hosted", "exchange", input)).status).not.toBe(200);
  expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
});
it("supersedes only the same browser owner's native login", async () => {
  const first = await authorize("browser-a");
  const firstAuth = generated;
  const sibling = await authorize("browser-b");
  await authorize("browser-a");
  expect(getOAuthFlow({ flowId: first.body.flowId, provider: "zed-hosted" })).toBeNull();
  expect(getOAuthFlow({ flowId: sibling.body.flowId, provider: "zed-hosted" })).not.toBeNull();
  expect((await post("zed-hosted", "exchange", { flowId: first.body.flowId, state: firstAuth.state, code: sealedCallback(firstAuth) })).status).not.toBe(200);
  expect(profile).not.toHaveBeenCalled();
});
