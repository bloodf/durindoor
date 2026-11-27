// Adobe Firefly is not implemented: the pinned source has no bearer-only
// contract. See docs/providers/adobe-firefly.md. These tests keep it
// unavailable and prove that a pasted token is neither stored nor sent.
// Closed mock: every fetch is recorded here and every token is synthetic.
// Passing here says nothing about the live service.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getProviderNodeById: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getProxyPoolById: vi.fn(async () => null),
  createProviderConnection: vi.fn(async (data) => ({ id: "c1", ...data })),
}));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));

import * as usageDb from "@/lib/usageDb.js";
import * as db from "@/lib/localDb";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { parseModel } from "../../open-sse/services/model.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { handleImageEditCore } from "../../open-sse/handlers/imageEditCore.js";
import { getVideoConfig } from "../../open-sse/handlers/videoCore.js";
import { handleVideoGenerationCore } from "../../open-sse/handlers/videoGenerationCore.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

const { POST: createProvider } = await import("@/app/api/providers/route.js");

const IDS = ["adobe-firefly", "firefly"];
const MODEL = "nano-banana-pro";
const NOW = Math.floor(Date.now() / 1000);

const jwt = (claims) => [{ alg: "RS256" }, claims].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).concat("synthetic-signature").join(".");
const claims = (account, exp) => ({ user_id: `synthetic-${account}@AdobeID`, client_id: "synthetic-client", exp });
const TOKEN_A = jwt(claims("a", NOW + 3600));
const TOKEN_B = jwt(claims("b", NOW + 3600));
const EXPIRED = jwt(claims("expired", NOW - 3600));
const MALFORMED = "synthetic-not-a-jwt.adobe";
const COOKIE = "ff_session_guid=synthetic-sid; sherlockToken=synthetic-arp";
const SECRETS = [TOKEN_A, TOKEN_B, EXPIRED, MALFORMED, COOKIE];

const CREDENTIALS = [
  ["a well-formed bearer", { apiKey: TOKEN_A }],
  ["an access-token field", { accessToken: TOKEN_A }],
  ["an expired bearer", { apiKey: EXPIRED }],
  ["a malformed bearer", { apiKey: MALFORMED }],
  ["a bearer with captured cookies", { apiKey: TOKEN_A, providerSpecificData: { cookie: COOKIE } }],
];

const upstream = vi.fn(async () => new Response(JSON.stringify({ err: "closed mock" }), { status: 599 }));

let restoreOriginalFetch;
beforeEach(async () => {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, undefined);
  const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
  restoreOriginalFetch = __setOriginalFetchForTesting(upstream);
  vi.stubGlobal("fetch", upstream);
  vi.clearAllMocks();
});
afterEach(() => {
  restoreOriginalFetch();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const expectNoSecret = (value) => {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};
const usageCalls = () => Object.values(usageDb).flatMap((fn) => fn.mock.calls);
const connect = (provider, apiKey) => createProvider(new Request("http://localhost/api/providers", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ provider, apiKey, name: "synthetic" }),
}));
const imageRun = (provider, credentials, hooks = {}) =>
  handleImageGenerationCore({ body: { prompt: "synthetic prompt" }, modelInfo: { provider, model: MODEL }, credentials, ...hooks });
const chatRun = (provider, credentials, stream) => handleChatCore({
  body: { model: MODEL, stream, messages: [{ role: "user", content: "ping" }] },
  modelInfo: { provider, model: MODEL },
  credentials,
});

describe("Adobe Firefly stays unavailable", () => {
  it("is claimed by no registry entry", () => {
    const names = REGISTRY.flatMap((entry) => [entry.id, entry.alias, entry.uiAlias, ...(entry.aliases ?? [])]);
    for (const id of IDS) expect(names).not.toContain(id);
  });

  it.each(IDS)("has no transport, media config, adapter or executor for %s", (id) => {
    expect(PROVIDERS[id]).toBeUndefined();
    expect(PROVIDER_MEDIA[id]).toBeUndefined();
    expect(getImageAdapter(id)).toBeNull();
    expect(getVideoConfig(id)).toBeNull();
    expect(hasSpecializedExecutor(id)).toBe(false);
  });

  it.each(IDS)("does not reroute %s model references to another provider", (id) => {
    expect(parseModel(`${id}/${MODEL}`)).toMatchObject({ provider: id, model: MODEL });
  });
});

describe("Adobe Firefly credential storage", () => {
  it.each(IDS.flatMap((id) => CREDENTIALS.map(([name, credentials]) => [id, name, credentials.apiKey ?? credentials.accessToken])))(
    "refuses to save a %s connection with %s",
    async (id, _name, secret) => {
      const response = await connect(id, secret);
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Invalid provider" });
      expect(db.createProviderConnection).not.toHaveBeenCalled();
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it("control: the same request shape saves a registered provider", async () => {
    await connect("openai", "synthetic-openai-key");
    expect(db.createProviderConnection).toHaveBeenCalledTimes(1);
  });
});

describe("Adobe Firefly dispatch sends nothing", () => {
  it.each(IDS.flatMap((id) => CREDENTIALS.map(([name, credentials]) => [id, name, credentials])))(
    "rejects image generation for %s with %s",
    async (id, _name, credentials) => {
      const onRequestSuccess = vi.fn();
      const onCredentialsRefreshed = vi.fn();
      const refreshCredentials = vi.fn();
      const input = structuredClone(credentials);
      const result = await imageRun(id, input, { onRequestSuccess, onCredentialsRefreshed, refreshCredentials });
      expect(result).toMatchObject({ success: false, status: 400, error: `Provider '${id}' does not support image generation` });
      expect(result.accounting).toBeUndefined();
      expect(result.acceptedJob).toBeUndefined();
      expectNoSecret(await result.response.json());
      expect(input).toEqual(credentials);
      for (const hook of [onRequestSuccess, onCredentialsRefreshed, refreshCredentials]) expect(hook).not.toHaveBeenCalled();
      expect(usageCalls()).toEqual([]);
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it.each(IDS)("rejects image edits and synchronous video for %s", async (id) => {
    const formData = new FormData();
    formData.append("prompt", "synthetic prompt");
    formData.append("image", new Blob(["synthetic"], { type: "image/png" }), "a.png");
    const edit = await handleImageEditCore({ formData, modelInfo: { provider: id, model: MODEL }, credentials: { apiKey: TOKEN_A } });
    const video = await handleVideoGenerationCore({ provider: id, model: "sora-2", body: { prompt: "synthetic prompt" }, credentials: { apiKey: TOKEN_A } });
    for (const result of [edit, video]) {
      expect(result).toMatchObject({ success: false, status: 400 });
      expectNoSecret(await result.response.json());
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  // No Firefly chat guard is needed: an unregistered id has no endpoint, so the
  // default executor fails before sending instead of using another vendor's URL.
  it.each(IDS.flatMap((id) => [false, true].map((stream) => [id, stream])))(
    "fails chat for %s (stream=%s) without a vendor fallback",
    async (id, stream) => {
      for (const [, credentials] of CREDENTIALS) {
        const result = await chatRun(id, structuredClone(credentials), stream);
        expect(result).toMatchObject({ success: false, status: 502 });
        expect(result.error).toContain(`Unknown provider "${id}": no supported transport endpoint`);
        expectNoSecret(await result.response.text());
      }
      expect(usageDb.saveRequestUsage).not.toHaveBeenCalled();
      expectNoSecret(usageCalls());
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it("keeps two concurrent accounts apart and sends neither token", async () => {
    const inputs = [{ apiKey: TOKEN_A, connectionId: "account-a" }, { apiKey: TOKEN_B, connectionId: "account-b" }];
    const before = structuredClone(inputs);
    const results = await Promise.all(inputs.map((credentials) => imageRun("adobe-firefly", credentials)));
    for (const result of results) expectNoSecret(await result.response.json());
    expect(inputs).toEqual(before);
    expect(usageCalls()).toEqual([]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ["image", () => imageRun("deepai", { apiKey: "synthetic-deepai-key" })],
    ["chat", () => chatRun("openai", { apiKey: "synthetic-openai-key" }, false)],
  ])("control: the closed mock sees a registered provider's %s request", async (_kind, send) => {
    const result = await send();
    expect(result.success).toBe(false);
    expect(upstream).toHaveBeenCalled();
  });
});
