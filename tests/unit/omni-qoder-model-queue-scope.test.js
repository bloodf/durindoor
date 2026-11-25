import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { resolveFallbackModelScope } from "../../open-sse/services/fallbackScope.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

// OmniRoute #18572 (head ec70441c): a Qoder model-queue throttle must lock the
// queued model only, never the whole Qoder connection. These cases pin the
// current DurinDoor policy (queue = model scope, code 112 quota = connection
// scope) and do not change it.
//
// Ordinary offline Qoder fields only: the registry catalog ids, the upstream
// 10605 queue envelope and the fork's own exhausted-queue 503 body.
const PROVIDER = "qoder";
const QUEUED_MODEL = "qmodel_38max";      // Qwen3.8-Max
const SIBLING_MODEL = "kmodel_latest";    // Kimi-K3
const SIBLING_MODEL_2 = "gmodel";         // GLM-5.3

// The envelope Qoder answers a queued request with: upstream code 10605 with a
// RESOURCE_LIMIT sub-code and the nested isQueued/retryAfterSeconds payload.
const QUEUED_ENVELOPE = {
  code: "10605",
  subCode: "RESOURCE_LIMIT",
  message: JSON.stringify({ isQueued: true, queueType: "p3", retryAfterSeconds: 30 }),
};

// The retryable 503 the Qoder executor returns once its own replay budget is
// spent (open-sse/executors/qoder.js).
const QUEUED_ERROR = {
  error: {
    message: "qoder model is queued; retry shortly",
    code: "qoder_model_queued",
    type: "rate_limit_error",
  },
};

// The distinct typed outcomes that keep their own policy.
const QUOTA_112_BODY = '{"code":"112","message":"quota exhausted"}';
const QUOTA_112_ERROR = { error: { message: QUOTA_112_BODY, code: 403 } };
const BILLING_110_BODY = '{"code":"110","message":"daily billing count exceeded"}';

let tempDir;
let originalDataDir;
let originalHome;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  originalHome = process.env.HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-qoder-queue-"));
  process.env.DATA_DIR = path.join(tempDir, "data");
  process.env.HOME = path.join(tempDir, "home");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function seed(provider = PROVIDER) {
  const localDb = await import("@/lib/localDb");
  const conn = await localDb.createProviderConnection({
    provider,
    authType: "apikey",
    name: `${provider}-queue`,
    apiKey: `${provider}-key`,
    isActive: true,
    testStatus: "active",
  });
  return { localDb, id: conn.id };
}

describe("Qoder queue outcome is a distinct type from quota and billing", () => {
  it("reads the mocked 10605 envelope as a queue signal, not as a quota or billing block", async () => {
    const { parseQoderQueueInfo } = await import("../../open-sse/shared/qoder/queue.js");
    const { isQoderQuotaExhaustedBody, __test__ } = await import("../../open-sse/executors/qoder.js");

    const info = parseQoderQueueInfo(JSON.stringify(QUEUED_ENVELOPE));
    expect(info?.isQueued).toBe(true);
    expect(info?.retryAfterSeconds).toBe(30);

    expect(isQoderQuotaExhaustedBody(QUEUED_ENVELOPE)).toBe(false);
    expect(isQoderQuotaExhaustedBody(QUEUED_ERROR)).toBe(false);
    expect(__test__.isBillingBlock(JSON.stringify(QUEUED_ENVELOPE))).toBe(false);
    expect(__test__.isBillingBlock(JSON.stringify(QUEUED_ERROR))).toBe(false);

    // The distinct typed outcomes still classify as themselves.
    expect(isQoderQuotaExhaustedBody(QUOTA_112_BODY)).toBe(true);
    expect(__test__.isBillingBlock(BILLING_110_BODY)).toBe(true);
  });

  it("classifies the queue 503 as a fallback-able transient failure that is not connection-scoped", () => {
    const result = checkFallbackError(
      503,
      JSON.stringify(QUEUED_ERROR),
      0,
      PROVIDER,
      null,
      QUEUED_ERROR,
    );
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    // "connection" would park every sibling model of the account.
    expect(result.scope).not.toBe("connection");
    expect(result.scope).toBeNull();
    expect(result.terminal).toBeUndefined();
    expect(result.requestScoped).toBeUndefined();
    expect(result.rateLimitEvidence).toBeUndefined();
  });
});

describe("Qoder queue scope resolves to the affected model", () => {
  it("keeps the queued model and its siblings on separate scopes", () => {
    expect(resolveFallbackModelScope(PROVIDER, QUEUED_MODEL)).toBe(QUEUED_MODEL);
    expect(resolveFallbackModelScope(PROVIDER, SIBLING_MODEL)).toBe(SIBLING_MODEL);
    expect(resolveFallbackModelScope(PROVIDER, SIBLING_MODEL_2)).toBe(SIBLING_MODEL_2);
  });

  it("locks the queued model only, so sibling models stay routable", async () => {
    const { buildModelLockUpdate, isModelLockActive } = await import("../../open-sse/services/accountFallback.js");
    const locked = { ...buildModelLockUpdate(QUEUED_MODEL, 30_000) };
    expect(isModelLockActive(locked, QUEUED_MODEL)).toBe(true);
    expect(isModelLockActive(locked, SIBLING_MODEL)).toBe(false);
    expect(isModelLockActive(locked, SIBLING_MODEL_2)).toBe(false);
  });
});

describe("Qoder queue persistence through markAccountUnavailable", () => {
  it("writes only the queued model's lock and leaves the connection usable", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const { isModelLockActive } = await import("../../open-sse/services/accountFallback.js");
    const { localDb, id } = await seed();

    const result = await markAccountUnavailable(
      id,
      503,
      JSON.stringify(QUEUED_ERROR),
      PROVIDER,
      QUEUED_MODEL,
      null,
      { attemptStartedAt: Date.now(), errorBody: QUEUED_ERROR },
    );
    expect(result.shouldFallback).toBe(true);

    const stored = await localDb.getProviderConnectionById(id);
    const lockKeys = Object.keys(stored).filter((key) => key.startsWith("modelLock_"));
    expect(lockKeys).toEqual([`modelLock_${QUEUED_MODEL}`]);
    expect(stored).not.toHaveProperty("modelLock___all");
    expect(isModelLockActive(stored, QUEUED_MODEL)).toBe(true);
    expect(isModelLockActive(stored, SIBLING_MODEL)).toBe(false);
    expect(isModelLockActive(stored, SIBLING_MODEL_2)).toBe(false);
    // A queue throttle is not an account failure: the connection stays active.
    expect(stored.isActive).toBe(true);
    expect(stored.autoDisabledReason).toBeFalsy();
    expect(stored.errorCode).toBe(503);
  });

  it("keeps the connection-wide quota policy for the code 112 outcome", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const { localDb, id } = await seed();

    const result = await markAccountUnavailable(
      id,
      403,
      `[403]: ${QUOTA_112_BODY}`,
      PROVIDER,
      QUEUED_MODEL,
      null,
      { attemptStartedAt: Date.now(), errorBody: QUOTA_112_ERROR },
    );
    expect(result.shouldFallback).toBe(true);

    const stored = await localDb.getProviderConnectionById(id);
    expect(stored.isActive).toBe(false);
    expect(stored.testStatus).toBe("unavailable");
    expect(stored.autoDisabledReason).toContain('"code":"112"');
  });

  it("keeps the credential-failure policy unchanged", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const { isModelLockActive } = await import("../../open-sse/services/accountFallback.js");
    const { localDb, id } = await seed();

    const result = await markAccountUnavailable(
      id,
      401,
      "unauthorized",
      PROVIDER,
      QUEUED_MODEL,
      null,
      { attemptStartedAt: Date.now() },
    );
    expect(result.shouldFallback).toBe(true);

    const stored = await localDb.getProviderConnectionById(id);
    // A rejected credential is not a queue outcome and not a quota disable.
    expect(stored.isActive).toBe(true);
    expect(stored.testStatus).not.toBe("reauth_required");
    expect(stored.autoDisabledReason).toBeFalsy();
    expect(Object.keys(stored).filter((key) => key.startsWith("modelLock_"))).toEqual([`modelLock_${QUEUED_MODEL}`]);
    expect(isModelLockActive(stored, SIBLING_MODEL)).toBe(false);
  });

  it("does not mint a durable lock key from an uncatalogued model string", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const { localDb, id } = await seed();

    await markAccountUnavailable(
      id,
      503,
      JSON.stringify(QUEUED_ERROR),
      PROVIDER,
      "attacker-chosen-model",
      null,
      { attemptStartedAt: Date.now(), errorBody: QUEUED_ERROR },
    );

    const stored = await localDb.getProviderConnectionById(id);
    expect(Object.keys(stored).filter((key) => key.startsWith("modelLock_"))).toEqual(["modelLock___all"]);
    expect(stored).not.toHaveProperty("modelLock_attacker-chosen-model");
  });
});

describe("combo behavior on a Qoder queue throttle", () => {
  it("advances to the next member without terminating the request", async () => {
    const models = ["qoder/qmodel_38max", "qoder/kmodel_latest"];
    const success = Response.json({ choices: [{ message: { content: "Hello" } }] });
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(QUEUED_ERROR), { status: 503 }))
      .mockResolvedValueOnce(success);

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "Hello" }] },
      models,
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "qoder-queue",
      comboStrategy: "fallback",
    });

    expect(response).toBe(success);
    expect(handleSingleModel.mock.calls.map((call) => call[1])).toEqual(models);
  });
});
