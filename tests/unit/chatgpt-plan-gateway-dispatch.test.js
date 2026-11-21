import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  readAccount: vi.fn(),
  refresh: vi.fn(),
  normalCredentials: vi.fn(),
  saveUsage: vi.fn(),
  key: { id: "verified-key", name: "Fixture", isActive: true },
  authId: "verified-key",
  ids: [],
  connections: [],
  combos: [],
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: true }),
  getApiKeyByKey: async () => state.key,
  getApiKeyUsageLimitStatus: async () => ({ enforced: false }),
  getApiKeyProviderConnectionIds: vi.fn(async (id) => id === "verified-key" ? state.ids : []),
  getProviderConnections: async ({ provider }) => state.connections.filter((row) => row.provider === provider),
  getComboByName: async (name) => state.combos.find((combo) => combo.name === name) || null,
  getComboForModel: async (name) => state.combos.find((combo) => combo.name === name) || null,
  getCombos: async () => state.combos,
  getDisabledModels: async () => ({}),
  getModelAliases: async () => ({}),
  getProviderNodes: async () => [],
  getCustomModels: async () => [],
  getSyncedModelCatalog: async () => null,
  getQuotaReservationPressure: async () => new Map(),
}));
vi.mock("@/lib/dataDir.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const DATA_DIR = mkdtempSync(join(tmpdir(), "plan-dispatch-"));
  return { DATA_DIR, getDataDir: () => DATA_DIR };
});
vi.mock("@/lib/apiKeyLimits.js", () => ({ enforceApiKeyLimits: async () => null }));
vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({ getSharedModelMetadata: async () => null }));
vi.mock("@/lib/oauth/chatgptPlanAccounts.js", () => ({
  createChatGptPlanAccounts: () => ({ readAccount: state.readAccount, refresh: state.refresh }),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({
    apiKey: "synthetic-server-key",
    auth: { ok: true, stored: true, apiKeyId: state.authId, billingEpoch: 1 },
  }),
  projectProviderCredentials: async (row) => ({ connectionName: row.id, providerSpecificData: row.providerSpecificData }),
  getProviderCredentialsWithQuotaPreflight: state.normalCredentials,
  markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
  isProviderConnectionModelLocked: () => false, providerAllowsPublicNoAuthFallback: () => false,
}));
vi.mock("../../src/sse/services/decisionBackend.js", () => ({ resolveDecisionBackend: async () => null }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: async () => null }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()), proxyAwareFetch: state.fetch,
}));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: async () => {},
  saveRequestDetail: async () => {}, saveRequestUsage: state.saveUsage, recordTokenSaverEvent: async () => {},
}));

import { rmSync } from "node:fs";
import { DATA_DIR } from "@/lib/dataDir.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getApiKeyProviderConnectionIds } from "@/lib/localDb";
import { POST as completions } from "@/app/api/v1/chat/completions/route.js";
import { POST as messages } from "@/app/api/v1/messages/route.js";

function connection(id) {
  const clientId = `oaiapp_${id}`;
  return {
    id, provider: "chatgpt-plan", isActive: true, authType: "oauth",
    accessToken: "wrong-connection-token",
    providerSpecificData: {
      chatgptPlanAccount: {
        id: createHash("sha256").update(clientId).digest("hex"),
        issuer: "https://auth.openai.com", subject: `subject-${id}`, clientId,
      },
    },
  };
}

const first = connection("first");
const second = connection("second");
const selection = (row) => row.providerSpecificData.chatgptPlanAccount;
const model = "chatgpt-plan/eligible";
const alternate = "chatgpt-plan/alternate";
const combo = (name, models, allowedConnectionIds) => ({ id: name, name, models, allowedConnectionIds });
const frame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const textItem = { id: "msg_fixture", type: "message", role: "assistant", status: "completed",
  content: [{ type: "output_text", text: "hello from fixture", annotations: [] }] };
const wire = (slug, truncated) => {
  const response = { id: "resp_fixture", object: "response", model: slug, created_at: 20 };
  return new Response(
    frame({ type: "response.created", response: { ...response, status: "in_progress", output: [] } }) +
    frame({ type: "response.output_text.delta", item_id: textItem.id, output_index: 0, content_index: 0, delta: "hello from fixture" }) +
    (truncated ? "" : frame({ type: "response.output_item.done", output_index: 0, item: textItem }) +
    frame({ type: "response.completed", response: {
      ...response, status: "completed", output: [textItem], usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    } })),
    { headers: { "Content-Type": "text/event-stream" } },
  );
};

function post(endpoint, { requestedModel = model, stream, pin } = {}) {
  const claude = endpoint === messages;
  return endpoint(new Request(`http://localhost/v1/${claude ? "messages" : "chat/completions"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-server-key",
      ...(pin ? { "x-connection-id": pin } : {}) },
    body: JSON.stringify({
      model: requestedModel, stream, ...(claude ? { max_tokens: 128 } : {}),
      messages: [{ role: "user", content: "hi" }],
      grant: { allowed: true, connectionId: second.id, accountId: selection(second).id },
    }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DURINDOOR_CHATGPT_PLAN_ENROLLMENT", "1");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  state.authId = state.key.id;
  state.ids = [first.id];
  state.connections = [first, second];
  state.combos = [];
  state.readAccount.mockImplementation(async (account) => ({
    ...account, planEnabled: true, accessToken: `synthetic-${account.subject}`, expiresAt: Date.now() + 60_000,
  }));
  state.saveUsage.mockResolvedValue(undefined);
  state.fetch.mockImplementation(async (url, options) => {
    if (url === "https://api.openai.com/v1/models") {
      return Response.json({ models: ["eligible", "alternate"].map((slug) => ({ slug, visibility: "list" })) });
    }
    expect(url).toBe("https://api.openai.com/v1/responses");
    return wire(JSON.parse(options.body).model);
  });
});
afterAll(() => rmSync(DATA_DIR, { recursive: true, force: true }));
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(state.normalCredentials).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each([
  ["direct Chat Completions JSON", completions, false, false],
  ["direct Chat Completions SSE", completions, true, false],
  ["combo Chat Completions JSON", completions, false, true],
  ["combo Chat Completions SSE", completions, true, true],
  ["direct Messages JSON", messages, false, false],
  ["direct Messages SSE", messages, true, false],
  ["combo Messages JSON", messages, false, true],
  ["combo Messages SSE", messages, true, true],
])("%s", (_label, endpoint, stream, isCombo) => {
  const requestedModel = isCombo ? "fixture-combo" : model;

  beforeEach(() => {
    if (!isCombo) return;
    state.combos = [
      combo(requestedModel, ["denied-member", "allowed-member"]),
      combo("denied-member", [model], [second.id]),
      combo("allowed-member", [alternate], [first.id]),
    ];
  });

  it("dispatches the scoped account and records terminal usage", async () => {
    const response = await post(endpoint, { requestedModel, stream });
    expect(response.status).toBe(200);
    const result = await response.text();
    expect(result).toContain("hello from fixture");
    expect(result).toContain(stream
      ? (endpoint === messages ? "message_stop" : '"finish_reason":"stop"')
      : (endpoint === messages ? "input_tokens" : "prompt_tokens"));
    expect(getApiKeyProviderConnectionIds).toHaveBeenCalledWith(state.authId);
    expect(state.readAccount).toHaveBeenCalledExactlyOnceWith(selection(first));
    expect(state.fetch).toHaveBeenCalledTimes(2);
    for (const [, options] of state.fetch.mock.calls) {
      expect(options.headers.Authorization).toBe("Bearer synthetic-subject-first");
      expect(options.redirect).toBe("error");
    }
    const outbound = JSON.parse(state.fetch.mock.calls[1][1].body);
    expect(outbound).toMatchObject({ model: isCombo ? "alternate" : "eligible", stream: true, store: false });
    expect(outbound).not.toHaveProperty("grant");
    expect(state.saveUsage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      apiKeyId: state.authId, connectionId: first.id, comboId: isCombo ? requestedModel : undefined,
      tokens: expect.objectContaining({ prompt_tokens: 3, completion_tokens: 4 }),
    }));
  });

  it("denies an empty key relation before touching the private account or transport", async () => {
    state.ids = [];
    expect((await post(endpoint, { requestedModel, stream })).ok).toBe(false);
    expect(state.readAccount).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.saveUsage).not.toHaveBeenCalled();
  });
});

it("requires a pin for multiple eligible connections and verifies its scope", async () => {
  state.ids = [first.id, second.id];
  expect((await post(completions, { stream: false })).status).toBe(403);
  expect((await post(completions, { stream: false, pin: "unscoped" })).status).toBe(403);
  expect(state.fetch).not.toHaveBeenCalled();

  expect((await post(completions, { stream: false, pin: second.id })).status).toBe(200);
  expect(state.readAccount).toHaveBeenCalledExactlyOnceWith(selection(second));
  expect(state.fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer synthetic-subject-second");
});

it("does not trust a key lookup with a different admitted identity", async () => {
  state.authId = "different-key";
  expect((await post(completions, { stream: false })).status).toBe(403);
  expect(state.fetch).not.toHaveBeenCalled();
});

it("blocks the private branch when owner enablement is off", async () => {
  vi.stubEnv("DURINDOOR_CHATGPT_PLAN_ENROLLMENT", "0");
  expect((await post(completions, { stream: false })).status).toBe(403);
  expect(state.fetch).not.toHaveBeenCalled();
});

it("does not switch a selected subscription through a nested fallback", async () => {
  state.ids = [first.id, second.id];
  state.combos = [
    combo("fixture-combo", ["first-only", "second-only"]),
    combo("first-only", [model], [first.id]),
    combo("second-only", [alternate], [second.id]),
  ];
  state.fetch.mockImplementation(async (url) => url.endsWith("/models")
    ? Response.json({ models: [{ slug: "eligible", visibility: "list" }] })
    : Response.json({ error: { message: "denied upstream" } }, { status: 403 }));
  expect((await post(completions, { requestedModel: "fixture-combo", stream: false })).ok).toBe(false);
  expect(state.readAccount.mock.calls).toEqual([[selection(first)]]);
  expect(state.fetch).toHaveBeenCalledTimes(2);
});

it.each([false, true])("does not record successful usage on truncation (stream=%s)", async (stream) => {
  state.fetch.mockImplementation(async (url) => url.endsWith("/models")
    ? Response.json({ models: [{ slug: "eligible", visibility: "list" }] })
    : wire("eligible", true));
  const response = await post(completions, { stream });
  if (stream) {
    expect(response.status).toBe(200);
    const result = await response.text().catch((error) => {
      expect(error.message).toMatch(/interrupted/);
      return "";
    });
    expect(result).not.toContain('"finish_reason":"stop"');
  } else {
    expect(response.status).toBe(502);
  }
  expect(state.saveUsage).not.toHaveBeenCalled();
});

it.each(["expired session", "inference 401"])("renews only the selected private account after %s", async (reason) => {
  state.ids = [first.id, second.id];
  let renewed = false;
  state.refresh.mockImplementation(async () => { renewed = true; });
  state.readAccount.mockImplementation(async (account) => ({
    ...account,
    planEnabled: true,
    accessToken: renewed ? "synthetic-replacement" : "synthetic-original",
    expiresAt: Date.now() + (!renewed && reason === "expired session" ? -1 : 60_000),
  }));
  const original = state.fetch.getMockImplementation();
  state.fetch.mockImplementation(async (url, options) => {
    if (!renewed && url.endsWith("/responses")) {
      return Response.json({ error: { message: "Expired access token" } }, { status: 401 });
    }
    return original(url, options);
  });
  const response = await post(completions, { stream: false, pin: first.id });
  expect(response.status).toBe(200);
  expect(state.refresh).toHaveBeenCalledExactlyOnceWith(selection(first));
  expect(state.readAccount.mock.calls.every(([account]) => account.id === selection(first).id)).toBe(true);
  expect(state.fetch.mock.calls.at(-1)[1].headers.Authorization).toBe("Bearer synthetic-replacement");
  expect(state.saveUsage).toHaveBeenCalledTimes(1);
});

it("preserves persisted strict egress and declines a bearer-terminating relay", async () => {
  state.connections = [{
    ...first,
    providerSpecificData: {
      ...first.providerSpecificData,
      oauthProxy: { mode: "strict-pool", poolId: "fixture-pool" },
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.invalid:8080",
    },
  }];
  expect((await post(completions, { stream: false })).status).toBe(200);
  for (const [, , proxy] of state.fetch.mock.calls) {
    expect(proxy).toMatchObject({
      strictProxy: true, disableEnvProxy: true, connectionProxyUrl: "http://proxy.invalid:8080",
    });
  }
  state.fetch.mockClear();
  state.connections[0].providerSpecificData.vercelRelayUrl = "https://relay.invalid";
  expect((await post(completions, { stream: false })).status).toBe(403);
  expect(state.fetch).not.toHaveBeenCalled();
});

it("requires private registration even when the owner flag is enabled", async () => {
  const index = REGISTRY.findIndex(({ id }) => id === "chatgpt-plan");
  const [descriptor] = REGISTRY.splice(index, 1);
  try {
    expect((await post(completions, { stream: false })).ok).toBe(false);
    expect(state.readAccount).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  } finally {
    REGISTRY.splice(index, 0, descriptor);
  }
});

it("does not select a newly eligible sibling after a direct transient failure", async () => {
  const original = state.fetch.getMockImplementation();
  state.fetch.mockImplementation(async (url, options) => {
    if (url.endsWith("/models")) return original(url, options);
    state.ids = [second.id];
    return Response.json({ error: { message: "Synthetic upstream unavailable" } }, { status: 503 });
  });
  expect((await post(completions, { stream: false })).ok).toBe(false);
  expect(state.readAccount).toHaveBeenCalledExactlyOnceWith(selection(first));
  expect(state.fetch).toHaveBeenCalledTimes(2);
});
