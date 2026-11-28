// Port of OmniRoute #21349 (KEA-9627, head b3ea831f1b9a2ddb5fc809f026d79cc49a932b02):
// Unknown bare models on chat, messages, and responses inference routes return
// HTTP 404 `model_not_found` (`invalid_request_error`) with zero upstream
// network dispatch, while preserving 400 syntax/schema/ambiguous/non-chat errors,
// explicit unknown-provider 404 wording, valid model routing, and non-cooling
// combo fallback.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const UNKNOWN_BARE = "kea-9627-nonexistent-model";
const envNames = ["HOME", "DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL", "REQUIRE_API_KEY"];
const globalNames = [
  "_dbAdapter", "_proxyTimelineAdapter", "_pendingRequests", "_lastErrorProvider",
  "_statsEmitter", "_pendingTimers", "_pendingCalls", "_recentRing",
  "_connectionMapCache", "_statsEmitTimers", "_activeSessions", "_activeSessionTimers",
  "__durindoorComboRuntime", "__durindoorOperationalMetrics", "__durindoorMetricsSampler",
];

let directory;
let originalEnv;
let originalGlobals;
let adapter;
let fetchMock;
let openaiConnection;

let postChat;
let getProviderConnectionById;
let getComboModelQuotaHealth;
let resetComboScoring;
let updateSettings;
let restrictedKey;
let credentialLookup;

function jsonPost(pathname, body) {
  return new Request(`https://gateway.test${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}

function mockOpenAIChatSuccess(url, init) {
  const parsed = init?.body ? JSON.parse(String(init.body)) : {};
  return Promise.resolve(
    Response.json({
      id: "chatcmpl-kea-9627",
      object: "chat.completion",
      created: 1,
      model: parsed.model || "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "Fallback OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    })
  );
}

beforeAll(async () => {
  originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  originalGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "dd-unknown-model-404-"));
  process.env.HOME = path.join(directory, "home");
  fs.mkdirSync(process.env.HOME, { mode: 0o700 });
  process.env.DATA_DIR = path.join(directory, "data");
  fs.mkdirSync(process.env.DATA_DIR, { mode: 0o700 });
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  process.env.REQUIRE_API_KEY = "false";
  delete process.env.DURINDOOR_PG_URL;
  for (const name of globalNames) delete globalThis[name];
  vi.resetModules();

  fetchMock = vi.fn(mockOpenAIChatSuccess);
  vi.stubGlobal("fetch", fetchMock);

  const driver = await import("@/lib/db/driver.js");
  adapter = await driver.getAdapter();
  const settingsRepo = await import("@/lib/db/repos/settingsRepo.js");
  updateSettings = settingsRepo.updateSettings;
  await updateSettings({ requireApiKey: false, enableProxyTimeline: false });

  const connectionsRepo = await import("@/lib/db/repos/connectionsRepo.js");
  getProviderConnectionById = connectionsRepo.getProviderConnectionById;
  openaiConnection = await connectionsRepo.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "kea-9627-openai-fixture",
    apiKey: "synthetic-fixture-only",
    isActive: true,
    testStatus: "active",
  });

  const keysRepo = await import("@/lib/db/repos/apiKeysRepo.js");
  restrictedKey = await keysRepo.createApiKey("review4-private", "review4-fixture", [], null, null, {
    policy: { allowedModels: ["openai/gpt-4o"] },
  });

  const aliasRepo = await import("@/lib/db/repos/aliasRepo.js");
  await aliasRepo.setModelAlias("kea-9627-bare-alias", "openai/gpt-4o");
  await aliasRepo.setModelAlias("kea-9627-denied-alias", "openai/gpt-4o-mini");
  await aliasRepo.addCustomModel({ providerAlias: "openai", id: "review2709-private-shared" });
  await aliasRepo.addCustomModel({ providerAlias: "xai", id: "review2709-private-shared" });

  const combosRepo = await import("@/lib/db/repos/combosRepo.js");
  await combosRepo.createCombo({
    name: "kea-9627-fallback",
    models: [UNKNOWN_BARE, "openai/gpt-4o"],
  });
  await combosRepo.createCombo({
    name: "kea-9627-all-unknown",
    models: [UNKNOWN_BARE],
  });

  ({ POST: postChat } = await import("../../src/app/api/v1/chat/completions/route.js"));
  const authModule = await import("../../src/sse/services/auth.js");
  credentialLookup = vi.spyOn(authModule, "getProviderCredentialsWithQuotaPreflight");
  ({ getComboModelQuotaHealth, resetComboScoring } = await import("../../open-sse/services/combo.js"));
});

beforeEach(async () => {
  fetchMock.mockReset().mockImplementation(mockOpenAIChatSuccess);
  resetComboScoring();
  credentialLookup.mockClear();
  await updateSettings({
    requireApiKey: false,
    enableProxyTimeline: false,
    comboStrategy: "fallback",
    comboStrategies: {},
  });
});

afterAll(() => {
  credentialLookup?.mockRestore();
  vi.unstubAllGlobals();
  try { adapter?.close?.(); } catch { /* ignore cleanup close error */ }
  for (const name of envNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
  for (const [name, desc] of originalGlobals.entries()) {
    if (desc) Object.defineProperty(globalThis, name, desc);
    else delete globalThis[name];
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

// Review4: exercise real route/auth/policy/resolution with a disposable database
// and a mocked upstream. Existing unrestricted regression assertions stay intact.
describe("restricted-key unknown model policy precedence", () => {
  async function restrictedChat(model) {
    const request = jsonPost("/v1/chat/completions", {
      model, messages: [{ role: "user", content: "Hello" }], stream: false,
    });
    request.headers.set("authorization", `Bearer ${restrictedKey.key}`);
    return postChat(request);
  }

  it.each([UNKNOWN_BARE, `openai/${UNKNOWN_BARE}`, "kea-9627-denied-alias", "kea-9627-missing-alias"])(
    "denies unresolved or disallowed model %s before upstream dispatch", async (model) => {
      const response = await restrictedChat(model);
      expect(response.status).toBe(403);
      expect((await response.json()).error.message).toContain("not allowed for this API key");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(credentialLookup).not.toHaveBeenCalled();
    }
  );

  it("denies private custom ambiguity before credentials or dispatch", async () => {
    const response = await restrictedChat("review2709-private-shared");
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe('Model "review2709-private-shared" is not allowed for this API key');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(credentialLookup).not.toHaveBeenCalled();
  });

  it.each(["kea-9627-bare-alias", "openai/gpt-4o", "gpt-4o"])(
    "allows configured aliases and valid provider models: %s", async (model) => {
      expect((await restrictedChat(model)).status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).model).toBe("gpt-4o");
    }
  );

  it.each(["openai/", "/gpt-4o"])("keeps malformed %s at 400", async (model) => {
    expect((await restrictedChat(model)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps composite policy denial terminal without health strikes or connection locks", async () => {
    const response = await restrictedChat("kea-9627-fallback");
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(credentialLookup).not.toHaveBeenCalled();
    expect(getComboModelQuotaHealth("kea-9627-fallback", UNKNOWN_BARE)).toBe("healthy");
    const connection = await getProviderConnectionById(openaiConnection.id);
    expect(connection.testStatus).toBe("active");
    expect(connection.rateLimitedUntil ?? null).toBeNull();
    expect(Object.entries(connection).filter(([k, v]) => k.startsWith("modelLock_") && v != null)).toEqual([]);
  });

  it("returns 403 when every composite leaf is denied", async () => {
    expect((await restrictedChat("kea-9627-all-unknown")).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getComboModelQuotaHealth("kea-9627-all-unknown", UNKNOWN_BARE)).toBe("healthy");
  });
});
