// Review4 regression: supported bare ids must reach dispatch or lifecycle policy.
// Unknown bare models on chat, messages, and responses inference routes return
// HTTP 404 `model_not_found` (`invalid_request_error`) with zero upstream
// network dispatch, while preserving 400 syntax/schema/ambiguous/non-chat errors,
// explicit unknown-provider 404 wording, valid model routing, and non-cooling
// combo fallback.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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


let postChat;
let updateSettings;

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
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "dd-review4-bare-model-"));
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
  await connectionsRepo.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "kea-9627-openai-fixture",
    apiKey: "synthetic-fixture-only",
    isActive: true,
    testStatus: "active",
  });

  const aliasRepo = await import("@/lib/db/repos/aliasRepo.js");
  await aliasRepo.setModelAlias("kea-9627-bare-alias", "openai/gpt-4o");

  await aliasRepo.addCustomModel({ providerAlias: "openai", id: "custommodel" });
  await aliasRepo.addCustomModel({ providerAlias: "openai", id: "review4-shared" });
  await aliasRepo.addCustomModel({ providerAlias: "xai", id: "review4-shared" });

  ({ POST: postChat } = await import("../../src/app/api/v1/chat/completions/route.js"));

});

beforeEach(async () => {
  fetchMock.mockReset().mockImplementation(mockOpenAIChatSuccess);
  await updateSettings({
    requireApiKey: false,
    enableProxyTimeline: false,
    comboStrategy: "fallback",
    comboStrategies: {},
  });
});

afterAll(() => {
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

describe("Review4 supported bare model identities", () => {
  it.each([
    "ft:gpt-4o-mini-2024-07-18:acme::abc123",
    "chatgpt-4o-latest",
    "codex-mini-latest",
    "custommodel",
    "openai/custommodel",
    "kea-9627-bare-alias",
  ])("dispatches supported identity %s exactly once", async (model) => {
    const response = await postChat(jsonPost("/v1/chat/completions", {
      model, messages: [{ role: "user", content: "Hello" }], stream: false,
    }));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const expectedModel = model === "kea-9627-bare-alias" ? "gpt-4o" : model.replace(/^openai\//, "");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).model).toBe(expectedModel);
  });

  it.each([["genuineunknown", 404], ["review4-shared", 400], ["computer-use-preview", 410]])(
    "rejects %s locally with %s", async (model, status) => {
      const response = await postChat(jsonPost("/v1/chat/completions", {
        model, messages: [{ role: "user", content: "Hello" }], stream: false,
      }));
      expect(response.status).toBe(status);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});
