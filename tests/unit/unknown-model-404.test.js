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
const UNKNOWN_BARE_MESSAGE = `Model '${UNKNOWN_BARE}' could not be resolved to a known provider.`;
const UNKNOWN_BARE_ERROR = {
  error: {
    message: UNKNOWN_BARE_MESSAGE,
    type: "invalid_request_error",
    code: "model_not_found",
    request_id: expect.any(String),
  },
};

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
let postMessages;
let postResponses;
let resolveModel;
let getProviderConnectionById;
let isProviderConnectionModelLocked;
let getComboModelQuotaHealth;
let resetComboScoring;
let checkFallbackError;
let updateSettings;

function jsonPost(pathname, body) {
  return new Request(`https://gateway.test${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}

function rawPost(pathname, rawBody) {
  return new Request(`https://gateway.test${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: rawBody,
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

  const aliasRepo = await import("@/lib/db/repos/aliasRepo.js");
  await aliasRepo.setModelAlias("kea-9627-bare-alias", "openai/gpt-4o");

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
  ({ POST: postMessages } = await import("../../src/app/api/v1/messages/route.js"));
  ({ POST: postResponses } = await import("../../src/app/api/v1/responses/route.js"));
  ({ resolveModel } = await import("../../src/sse/handlers/chat/singleModel/resolveModel.js"));
  ({ isProviderConnectionModelLocked } = await import("../../src/sse/services/auth.js"));
  ({ getComboModelQuotaHealth, resetComboScoring } = await import("../../open-sse/services/combo.js"));
  ({ checkFallbackError } = await import("../../open-sse/services/accountFallback.js"));
});

beforeEach(async () => {
  fetchMock.mockReset().mockImplementation(mockOpenAIChatSuccess);
  resetComboScoring();
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

describe("Unknown bare model 404 parity (OmniRoute #21349 / KEA-9627)", () => {
  it("returns HTTP 404 model_not_found with zero upstream dispatch on /v1/chat/completions", async () => {
    const response = await postChat(
      jsonPost("/v1/chat/completions", {
        model: UNKNOWN_BARE,
        messages: [{ role: "user", content: "Hello" }],
        stream: false,
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(UNKNOWN_BARE_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "returns HTTP 404 model_not_found with zero upstream dispatch on /v1/messages (stream=%s)",
    async (stream) => {
      const response = await postMessages(
        jsonPost("/v1/messages", {
          model: UNKNOWN_BARE,
          max_tokens: 32,
          messages: [{ role: "user", content: "Hello" }],
          stream,
        })
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(UNKNOWN_BARE_ERROR);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    "returns HTTP 404 model_not_found with zero upstream dispatch on /v1/responses (stream=%s)",
    async (stream) => {
      const response = await postResponses(
        jsonPost("/v1/responses", {
          model: UNKNOWN_BARE,
          input: "Hello",
          stream,
        })
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(UNKNOWN_BARE_ERROR);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("preserves HTTP 400 for malformed JSON, schema violations, invalid model syntax, image-only, and non-chat models", async () => {
    // Malformed JSON
    const badJson = await postChat(rawPost("/v1/chat/completions", "{not-json"));
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({
      error: { message: "Invalid JSON body", type: "invalid_request_error", code: "bad_request", request_id: expect.any(String) },
    });

    // Missing messages (schema violation)
    const missingMessages = await postChat(jsonPost("/v1/chat/completions", { model: UNKNOWN_BARE }));
    expect(missingMessages.status).toBe(400);
    expect(await missingMessages.json()).toEqual({
      error: { message: "messages: Expected array, received undefined", type: "invalid_request_error", request_id: expect.any(String) },
    });

    // Non-string model (schema violation)
    const nonStringModel = await postChat(
      jsonPost("/v1/chat/completions", { model: 42, messages: [{ role: "user", content: "Hello" }] })
    );
    expect(nonStringModel.status).toBe(400);
    expect(await nonStringModel.json()).toEqual({
      error: { message: "model: Expected string, received number", type: "invalid_request_error", request_id: expect.any(String) },
    });

    // Empty / whitespace-only model syntax
    for (const model of ["", "   "]) {
      const emptyModel = await postChat(
        jsonPost("/v1/chat/completions", { model, messages: [{ role: "user", content: "Hello" }] })
      );
      expect(emptyModel.status).toBe(400);
      expect(await emptyModel.json()).toEqual({
        error: { message: "Missing model", type: "invalid_request_error", code: "bad_request", request_id: expect.any(String) },
      });
    }

    // Invalid slash model syntax must not be classified as unknown model 404
    for (const model of ["/", "/gpt-4o", " / model ", "openai/", " cx / "]) {
      const invalidSyntax = await postChat(
        jsonPost("/v1/chat/completions", { model, messages: [{ role: "user", content: "Hello" }] })
      );
      expect(invalidSyntax.status).toBe(400);
      expect(await invalidSyntax.json()).toEqual({
        error: { message: "Invalid model format", type: "invalid_request_error", code: "bad_request", request_id: expect.any(String) },
      });
    }

    // Image-only model (prefixed and bare OpenAI catalog id)
    for (const model of ["openai/gpt-image-1.5", "chatgpt-image-latest"]) {
      const imageOnly = await postChat(
        jsonPost("/v1/chat/completions", { model, messages: [{ role: "user", content: "Hello" }] })
      );
      expect(imageOnly.status).toBe(400);
      const body = await imageOnly.json();
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.code).toBe("bad_request");
      expect(body.error.message).toContain("image-generation model");
    }

    // Non-chat model (prefixed and bare OpenAI catalog ids)
    for (const model of ["openai/text-embedding-3-small", "text-embedding-3-small", "tts-1"]) {
      const nonChat = await postChat(
        jsonPost("/v1/chat/completions", { model, messages: [{ role: "user", content: "Hello" }] })
      );
      expect(nonChat.status).toBe(400);
      const body = await nonChat.json();
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.code).toBe("bad_request");
      expect(body.error.message).toContain("not a chat model");
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves HTTP 400 when resolution reports ambiguous_model", async () => {
    const outcome = await resolveModel({
      request: jsonPost("/v1/chat/completions", { model: "shared-model", messages: [{ role: "user", content: "Hi" }] }),
      requestSignal: null,
      modelStr: "shared-model",
      resolveModelInfo: async () => ({
        provider: null,
        model: "shared-model",
        errorType: "ambiguous_model",
        errorMessage: "Ambiguous model 'shared-model'. Use provider/model prefix.",
      }),
    });

    expect(outcome.kind).toBe("terminal");
    expect(outcome.response.status).toBe(400);
    expect(await outcome.response.json()).toEqual({
      error: {
        message: "Ambiguous model 'shared-model'. Use provider/model prefix.",
        type: "invalid_request_error",
        code: "bad_request",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves explicit unknown-provider 404 message", async () => {
    const response = await postChat(
      jsonPost("/v1/chat/completions", {
        model: "unknown-provider/missing-model",
        messages: [{ role: "user", content: "Hello" }],
        stream: false,
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        message: 'Unknown provider "unknown-provider" in model "unknown-provider/missing-model". See /v1/models for what this router serves.',
        type: "invalid_request_error",
        code: "model_not_found",
        request_id: expect.any(String),
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["prefixed OpenAI model", "openai/gpt-4o", "gpt-4o"],
    ["bare recognized OpenAI prefix", "gpt-4o", "gpt-4o"],
    ["bare configured model alias", "kea-9627-bare-alias", "gpt-4o"],
  ])("keeps valid model routing unchanged for %s (%s)", async (_label, model, expectedUpstreamModel) => {
    const response = await postChat(
      jsonPost("/v1/chat/completions", {
        model,
        messages: [{ role: "user", content: "Hello" }],
        stream: false,
      })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body)).model).toBe(expectedUpstreamModel);
  });

  it("advances combo fallback past an unknown bare model without cooldown, locks, or health-score strikes", async () => {
    await updateSettings({
      requireApiKey: false,
      enableProxyTimeline: false,
      comboStrategy: "smart-scoring",
      comboStrategies: {},
    });

    const response = await postChat(
      jsonPost("/v1/chat/completions", {
        model: "kea-9627-fallback",
        messages: [{ role: "user", content: "Hello" }],
        stream: false,
      })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body)).model).toBe("gpt-4o");

    const saved = await getProviderConnectionById(openaiConnection.id);
    expect(saved?.testStatus).toBe("active");
    expect(saved?.rateLimitedUntil ?? null).toBeNull();
    expect(
      Object.entries(saved || {}).filter(([key, value]) => key.startsWith("modelLock_") && value != null)
    ).toEqual([]);
    expect(isProviderConnectionModelLocked(saved, "openai", "gpt-4o")).toBe(false);
    expect(getComboModelQuotaHealth("kea-9627-fallback", UNKNOWN_BARE)).toBe("healthy");
    expect(
      checkFallbackError({
        status: 404,
        errorText: UNKNOWN_BARE_MESSAGE,
        structuredError: {
          error: {
            message: UNKNOWN_BARE_MESSAGE,
            type: "invalid_request_error",
            code: "model_not_found",
          },
        },
      })
    ).toMatchObject({ shouldFallback: false, cooldownMs: 0 });
  });

  it("returns 404 model_not_found when every combo candidate is an unknown bare model", async () => {
    const response = await postChat(
      jsonPost("/v1/chat/completions", {
        model: "kea-9627-all-unknown",
        messages: [{ role: "user", content: "Hello" }],
        stream: false,
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(UNKNOWN_BARE_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
