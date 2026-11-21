/**
 * #2034 — Grokified provider (prepaid OpenAI-compatible Grok gateway).
 *
 * Closed mock acceptance through the normal routes: the only egress is the
 * mocked `proxyAwareFetch`; `globalThis.fetch` throws so a real network call
 * fails this file. No credentials, paid calls, browser, e2e or Docker are
 * involved, and nothing here proves live Grokified service behavior.
 *
 * Covered: the registry contract, separately scoped keys, authenticated model
 * discovery, JSON and SSE chat completions, provider-reported usage, and the
 * auth / entitlement / quota error classes the vendor documents.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...await original(), proxyAwareFetch: wire }));
vi.mock("open-sse/services/liveModelLimits.js", async (original) => ({ ...await original(), warmLiveModelLimits: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
// Keep the unrelated import-time user-agent updater off native fetch and timers.
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-fixture",
  updateKimchiUserAgent: vi.fn().mockResolvedValue("kimchi/offline-fixture"),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { PROVIDER_ID_TO_ALIAS, getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { AI_PROVIDERS, APIKEY_PROVIDERS, isRoutableProvider } from "../../src/shared/constants/providers.js";
import { addBufferToUsage } from "../../open-sse/utils/usageTracking.js";
import { parseModel } from "../../open-sse/services/model.js";

const provider = "grokified";
const CHAT_URL = "https://api.grokified.com/v1/chat/completions";
const MODELS_URL = "https://api.grokified.com/v1/models";
const MODEL = "grok-4.7";
const OWNED_KEY = "gk_test_fixture-owned-not-a-credential";
const OTHER_KEY = "gk_test_fixture-other-not-a-credential";

const usage = {
  prompt_tokens: 11,
  completion_tokens: 7,
  total_tokens: 18,
  // Vendor cost block (https://grokified.com/docs/usage-tracking).
  grokified: { list_usd: 0.0123, charged_usd: 0.0061, discount_usd: 0.0062, balance_usd: 4.39 },
};
const reply = {
  id: "grokified-offline",
  object: "chat.completion",
  created: 1763625600,
  model: MODEL,
  choices: [{ index: 0, message: { role: "assistant", content: "Grokified fixture reply." }, finish_reason: "stop" }],
  usage,
};
const bufferedUsage = addBufferToUsage(
  { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens },
  provider,
);
const chunk = (delta, finish_reason = null, extra = {}) => ({
  id: "grokified-offline",
  object: "chat.completion.chunk",
  created: 1763625600,
  model: MODEL,
  choices: [{ index: 0, delta, finish_reason }],
  ...extra,
});

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", ...headers },
});
const sse = (frames) => new Response(new ReadableStream({
  start(controller) {
    const bytes = new TextEncoder().encode(frames.join(""));
    for (let i = 0; i < bytes.length; i += 23) controller.enqueue(bytes.slice(i, i + 23));
    controller.close();
  },
}), { headers: { "Content-Type": "text/event-stream" } });

let db, adapter, post, discover, gatewayModels, buildProbe, owned, other, caller, otherCaller, directory;

const chatRequest = (body = {}, headers = {}) => new Request("https://gateway.test/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${caller.key}`, ...headers },
  body: JSON.stringify({ model: `${provider}/${MODEL}`, messages: [{ role: "user", content: "Hello" }], ...body }),
});

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-grokified-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected direct fetch in closed fixture"); }));
  db = await import("@/lib/localDb");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  await db.updateSettings({ requireApiKey: true });
  owned = await db.createProviderConnection({
    name: "Grokified owned", provider, authType: "apikey", apiKey: OWNED_KEY, isActive: true,
  });
  other = await db.createProviderConnection({
    name: "Grokified other", provider, authType: "apikey", apiKey: OTHER_KEY, isActive: true,
  });
  caller = await db.createApiKey("Grokified client", "synthetic-machine", [], null, null, { providerConnectionIds: [owned.id] });
  otherCaller = await db.createApiKey("Grokified other client", "synthetic-machine", [], null, null, { providerConnectionIds: [other.id] });
  ({ POST: post } = await import("@/app/api/v1/chat/completions/route.js"));
  ({ GET: discover } = await import("@/app/api/providers/[id]/models/route.js"));
  ({ GET: gatewayModels } = await import("@/app/api/v1/models/route.js"));
  ({ buildRegistryProviderProbe: buildProbe } = await import("@/app/api/providers/providerProbe.js"));
}, 30_000);

afterAll(async () => {
  await adapter?.close?.();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  wire.mockReset();
  wire.mockImplementation(async (url, init) => {
    if (url === MODELS_URL) {
      const key = new Headers(init.headers).get("Authorization");
      const ids = key === `Bearer ${OTHER_KEY}`
        ? ["grok-build-0.1"]
        : [MODEL, "grok-4.3", "grok-imagine-image-2.0", "grok-imagine-video", "claude-opus-5", "grok-4.20-multi-agent-0309"];
      return json({ object: "list", data: ids.map((id) => ({ id, object: "model" })) });
    }
    if (url !== CHAT_URL) return json({ error: { message: "Unexpected fixture route", type: "not_found", code: "not_found" } }, 404);
    const body = JSON.parse(init.body);
    if (body.stream) {
      return sse([
        `data: ${JSON.stringify(chunk({ role: "assistant", content: "Grokified " }))}\n\n`,
        `data: ${JSON.stringify(chunk({ content: "fixture reply." }))}\n\n`,
        `data: ${JSON.stringify(chunk({}, "stop", { usage }))}\n\n`,
        "data: [DONE]\n\n",
      ]);
    }
    return json(reply);
  });
});

describe("Grokified registry contract", () => {
  it("registers the documented OpenAI-compatible API-key provider", () => {
    const entry = REGISTRY.find((item) => item.id === provider);
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("grokified");
    expect(PROVIDER_ID_TO_ALIAS.grokified).toBe("grokified");
    expect(APIKEY_PROVIDERS.grokified).toBeDefined();
    expect(isRoutableProvider("grokified")).toBe(true);
    expect(PROVIDERS.grokified.baseUrl).toBe(CHAT_URL);
    expect(PROVIDERS.grokified.validateUrl).toBe(MODELS_URL);
    expect(PROVIDERS.grokified.format).toBe("openai");
    expect(AI_PROVIDERS.grokified.modelsFetcher).toMatchObject({ url: MODELS_URL, type: "openai" });
    expect(AI_PROVIDERS.grokified.passthroughModels).toBe(true);
  });

  it("seeds only the documented text catalog and keeps the Responses-only model out", () => {
    expect(PROVIDER_MODELS.grokified.map((model) => model.id)).toEqual([
      "grok-4.7",
      "grok-4.6",
      "grok-4.5",
      "grok-4.3",
      "grok-4.20-0309-reasoning",
      "grok-4.20-0309-non-reasoning",
      "grok-build-0.1",
    ]);
    // The vendor documents this one as "Responses API only. It does not work
    // through Chat Completions." so it must not appear in the chat catalog.
    expect(PROVIDER_MODELS.grokified.map((model) => model.id)).not.toContain("grok-4.20-multi-agent-0309");
  });

  it("resolves the vendor's legacy and retired model names to their current ids", () => {
    expect(getModelUpstreamId("grokified", "gx-1-max")).toBe("grok-4.7");
    expect(getModelUpstreamId("grokified", "grokified-4.6")).toBe("grok-4.7");
    expect(getModelUpstreamId("grokified", "gx-build")).toBe("grok-build-0.1");
    expect(getModelUpstreamId("grokified", "grok-code-fast-1")).toBe("grok-build-0.1");
    expect(getModelUpstreamId("grokified", "grok-3")).toBe("grok-4.3");
    expect(getModelUpstreamId("grokified", "gx-1-fast-reasoning")).toBe("grok-4.20-0309-reasoning");
  });

  it("routes a namespaced model id without losing the provider scope", () => {
    expect(parseModel("grokified/grok-4.7")).toMatchObject({ provider: "grokified", model: "grok-4.7" });
  });

  it("probes the documented key-check endpoint with the Bearer credential", () => {
    const probe = buildProbe(provider, OWNED_KEY);
    expect(probe.url).toBe(MODELS_URL);
    expect(new Headers(probe.options.headers).get("Authorization")).toBe(`Bearer ${OWNED_KEY}`);
  });
});

describe("Grokified closed mock acceptance", () => {
  it("isolates synced catalogs and ignores legacy provider-wide model IDs", async () => {
    const { syncProviderModels } = await import("@/lib/modelAutoSync/runner.js");
    await db.updateSettings({ modelAutoSyncProviders: { grokified: true } });
    await db.saveSyncedModelCatalog(provider, {
      syncedAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(),
      models: [{ id: "legacy-private-id", name: "legacy-private-id", kind: "llm" }]
    });
    const fetchModels = vi.fn(async (connection) => ({ models: [{ id: connection.id === owned.id ? "owned-private-id" : "other-private-id" }] }));
    expect((await syncProviderModels(provider, { fetchModels })).status).toBe("synced");
    const list = async (key) => (await (await gatewayModels(new Request("http://localhost/v1/models", {
      headers: { authorization: `Bearer ${key}` }
    }))).json()).data.map((model) => model.id);
    const ownIds = await list(caller.key);
    const otherIds = await list(otherCaller.key);
    expect(ownIds).toContain("grokified/owned-private-id");
    expect(ownIds).not.toContain("grokified/other-private-id");
    expect(otherIds).toContain("grokified/other-private-id");
    expect(otherIds).not.toContain("grokified/owned-private-id");
    expect(JSON.stringify([ownIds, otherIds, await db.getSyncedModelCatalog(provider)])).not.toContain("legacy-private-id");
    await db.updateSettings({ modelAutoSyncProviders: {} });
  });

  it("sends only the scoped connection's key and rejects a foreign connection pin", async () => {
    const response = await post(chatRequest());
    expect(response.status).toBe(200);
    const [url, init] = wire.mock.calls[0];
    expect(url).toBe(CHAT_URL);
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${OWNED_KEY}`);
    expect(new Headers(init.headers).get("Authorization")).not.toContain(OTHER_KEY);

    const denied = await post(chatRequest({}, { "x-connection-id": other.id }));
    expect(denied.status).toBe(400);
    expect(await denied.text()).toContain("not available for this API key");
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it("discovers the live catalog per connection with that connection's key", async () => {
    const ownModels = await discover(new Request("https://gateway.test/api/providers/id/models"), { params: Promise.resolve({ id: owned.id }) });
    expect(ownModels.status).toBe(200);
    expect((await ownModels.json()).models.map((model) => model.id)).toEqual([MODEL, "grok-4.3"]);
    expect(wire.mock.calls[0][0]).toBe(MODELS_URL);
    expect(new Headers(wire.mock.calls[0][1].headers).get("Authorization")).toBe(`Bearer ${OWNED_KEY}`);

    const otherModels = await discover(new Request("https://gateway.test/api/providers/id/models"), { params: Promise.resolve({ id: other.id }) });
    expect(otherModels.status).toBe(200);
    expect((await otherModels.json()).models.map((model) => model.id)).toEqual(["grok-build-0.1"]);
    expect(new Headers(wire.mock.calls[1][1].headers).get("Authorization")).toBe(`Bearer ${OTHER_KEY}`);
  });

  it("surfaces a discovery failure instead of inventing a catalog", async () => {
    wire.mockResolvedValueOnce(json({ error: { message: "Invalid API key" } }, 401));
    const failed = await discover(new Request("https://gateway.test/api/providers/id/models"), { params: Promise.resolve({ id: owned.id }) });
    expect(failed.status).toBe(401);
    expect((await failed.json()).error).toContain("401");
  });

  it("completes a JSON chat completion and records the provider-reported usage", async () => {
    const before = await db.getApiKeyUsageTotals(caller.id);
    const response = await post(chatRequest({ stream: false }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe("Grokified fixture reply.");
    // The client-facing usage carries the provider's own counts plus the
    // gateway-wide safety buffer it applies to every provider.
    expect(body.usage).toMatchObject(bufferedUsage);
    const [url, init] = wire.mock.calls[0];
    expect(url).toBe(CHAT_URL);
    expect(JSON.parse(init.body)).toMatchObject({ model: MODEL, stream: false });
    await vi.waitFor(async () => {
      expect((await db.getApiKeyUsageTotals(caller.id)).totalTokens).toBe(before.totalTokens + 18);
    });
  });

  it("streams a chat completion with the terminal usage frame", async () => {
    const before = await db.getApiKeyUsageTotals(caller.id);
    const response = await post(chatRequest({ stream: true }));
    expect(response.status).toBe(200);
    const events = (await response.text()).split("\n").filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)));
    expect(events.map((event) => event.choices[0].delta.content).join("")).toBe("Grokified fixture reply.");
    expect(events.at(-1).usage).toMatchObject(bufferedUsage);
    const [, init] = wire.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ model: MODEL, stream: true, stream_options: { include_usage: true } });
    await vi.waitFor(async () => {
      expect((await db.getApiKeyUsageTotals(caller.id)).totalTokens).toBe(before.totalTokens + 18);
    });
  });

  it.each([
    [401, "invalid_api_key"],
    [402, "insufficient_quota"],
    [402, "payment_required"],
    [403, "account_suspended"],
    [403, "plan_capability_required"],
    [429, "rate_limit_exceeded"],
  ])("preserves the vendor's %s %s status for the client", async (status, code) => {
    // A rejected call locks the account it hit, so each status gets its own
    // connection and its own client key. That also proves the key scope keeps
    // the failed account from leaking into another key's request.
    const account = await db.createProviderConnection({
      name: `Grokified ${code}`, provider, authType: "apikey", apiKey: `gk_test_${code}-not-a-credential`, isActive: true,
    });
    const scoped = await db.createApiKey(`Grokified ${code} client`, "synthetic-machine", [], null, null, { providerConnectionIds: [account.id] });
    wire.mockImplementation(async () => json({ error: { message: `Grokified ${code}`, type: code, code } }, status));

    const response = await post(new Request("https://gateway.test/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${scoped.key}` },
      body: JSON.stringify({ model: `${provider}/${MODEL}`, messages: [{ role: "user", content: "Hello" }], stream: false }),
    }));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain(code);
    expect(JSON.stringify(body)).not.toContain("gk_test_");
  });

  it("does not echo the stored key back to the client on a rejected call", async () => {
    wire.mockImplementation(async () => json({ error: { message: "Bad key", type: "invalid_api_key", code: "invalid_api_key" } }, 401));
    const response = await post(chatRequest({ stream: false }));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(OWNED_KEY);
  });

  it("lists the provider in the gateway model catalog", async () => {
    const response = await gatewayModels(new Request("https://gateway.test/v1/models", {
      headers: { authorization: `Bearer ${caller.key}` },
    }));
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.map((model) => model.id)).toContain(`${provider}/${MODEL}`);
  });

  it("keeps a second client scoped to its own Grokified key", async () => {
    const response = await post(new Request("https://gateway.test/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${otherCaller.key}` },
      body: JSON.stringify({ model: `${provider}/${MODEL}`, messages: [{ role: "user", content: "Hello" }] }),
    }));
    expect(response.status).toBe(200);
    expect(wire).toHaveBeenCalledTimes(1);
    expect(new Headers(wire.mock.calls[0][1].headers).get("Authorization")).toBe(`Bearer ${OTHER_KEY}`);
  });
});
