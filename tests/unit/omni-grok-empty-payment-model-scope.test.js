import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { CREDITS_EXHAUSTED_SIGNALS } from "../../open-sse/services/fakeSuccessBodyClassifier.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

// OmniRoute #20461 (head d67892c0): an HTTP 402 with an empty body from a Grok
// route must stay model-scoped instead of parking the whole connection. These
// are the Grok routes present in DurinDoor; there is no shared-wallet or
// xai-oauth path here. The tests pin the current policy and do not change it.
const ROUTES = [
  ["grok-cli", "grok-4.6", "grok-4.5"],
  ["grok-web", "grok-4", "grok-3"],
  ["xai", "grok-4.6", "grok-4.5"],
];
const CREDIT_BODY = { error: { message: "Your credit balance is too low to access this API." } };
const ORDINARY_BODY = { error: { message: "payment required" } };

let tempDir;
let originalDataDir;
let originalHome;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  originalHome = process.env.HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-grok-402-"));
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

async function seed(provider) {
  const localDb = await import("@/lib/localDb");
  const conn = await localDb.createProviderConnection({
    provider,
    authType: "apikey",
    name: `${provider}-402`,
    apiKey: `${provider}-key`,
    isActive: true,
    testStatus: "active",
  });
  return { localDb, id: conn.id };
}

describe("empty Grok HTTP 402 classification", () => {
  it.each(ROUTES)("%s: empty and blank bodies are a terminal, connection-neutral 402", (provider) => {
    for (const body of ["", "   \n", null, undefined]) {
      const result = checkFallbackError(402, body, 0, provider);
      expect(result).toMatchObject({ shouldFallback: true, terminal: true });
      expect(result.scope).toBeNull();
      expect(result.rateLimitEvidence).toBeUndefined();
    }
  });

  it("explicit credit-balance evidence is distinguishable but classified the same way", () => {
    const evidence = JSON.stringify(CREDIT_BODY).toLowerCase();
    expect(CREDITS_EXHAUSTED_SIGNALS.some((signal) => evidence.includes(signal))).toBe(true);
    for (const empty of ["", "{}", JSON.stringify({ error: {} })]) {
      expect(CREDITS_EXHAUSTED_SIGNALS.some((signal) => empty.includes(signal))).toBe(false);
    }
    const [provider] = ROUTES[0];
    const empty = checkFallbackError(402, "", 0, provider);
    const credit = checkFallbackError(402, JSON.stringify(CREDIT_BODY), 0, provider, null, CREDIT_BODY);
    expect(credit).toMatchObject({ shouldFallback: true, terminal: true, cooldownMs: empty.cooldownMs });
    expect(credit.scope).toBeNull();
  });
});

describe("Grok 402 persistence through markAccountUnavailable", () => {
  const bodies = [
    ["empty body", ""],
    ["ordinary payment body", JSON.stringify(ORDINARY_BODY), ORDINARY_BODY],
    ["explicit credit-balance body", JSON.stringify(CREDIT_BODY), CREDIT_BODY],
  ];

  for (const [provider, failing, sibling] of ROUTES) {
    it.each(bodies)(`${provider}: %s locks only the failing model`, async (_label, text, structured) => {
      const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
      const { isModelLockActive } = await import("../../open-sse/services/accountFallback.js");
      const { localDb, id } = await seed(provider);

      const result = await markAccountUnavailable(id, 402, text, provider, failing, null, {
        attemptStartedAt: Date.now(),
        errorBody: structured ?? null,
      });
      expect(result.shouldFallback).toBe(true);

      const stored = await localDb.getProviderConnectionById(id);
      const lockKeys = Object.keys(stored).filter((key) => key.startsWith("modelLock_"));
      expect(lockKeys).toEqual([`modelLock_${failing}`]);
      expect(stored).not.toHaveProperty("modelLock___all");
      expect(isModelLockActive(stored, failing)).toBe(true);
      expect(isModelLockActive(stored, sibling)).toBe(false);
      expect(stored.errorCode).toBe(402);
      expect(stored.testStatus).not.toBe("credits_exhausted");
    });
  }

  it("does not mint a durable key from an uncatalogued model string", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const { localDb, id } = await seed("grok-cli");
    await markAccountUnavailable(id, 402, "", "grok-cli", "attacker-chosen-model", null, {
      attemptStartedAt: Date.now(),
    });
    const stored = await localDb.getProviderConnectionById(id);
    expect(Object.keys(stored).filter((key) => key.startsWith("modelLock_"))).toEqual(["modelLock___all"]);
    expect(stored).not.toHaveProperty("modelLock_attacker-chosen-model");
  });
});

describe("combo behavior on an empty Grok 402", () => {
  it("advances to the next member without terminating the request", async () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["grok-cli/grok-4.6", "grok-cli/grok-4.5", "xai/grok-4.6"];
    const success = Response.json({ choices: [{ message: { content: "Hello" } }] });
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 402 }))
      .mockResolvedValueOnce(new Response("", { status: 402 }))
      .mockResolvedValueOnce(success);

    const response = await handleComboChat({
      body,
      models,
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "grok-empty-402",
      comboStrategy: "fallback",
    });

    expect(response).toBe(success);
    expect(handleSingleModel.mock.calls.map((call) => call[1])).toEqual(models);
  });
});
