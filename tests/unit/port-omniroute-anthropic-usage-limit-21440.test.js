import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkFallbackError, isModelLockActive } from "../../open-sse/services/accountFallback.js";
import {
  anthropicAccountCreditMessage,
  isAnthropicCreditProvider,
  parseAnthropicRegainAccessResetMs,
} from "../../open-sse/services/anthropicAccountCredit.js";
import { COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

// OmniRoute PR #21440 (open; head 115338ff9f3f6ddd547fa0948b6d1a114114f0ef, MIT):
// Anthropic's 400 credit-balance and specified-API-usage-limit answers park the
// whole connection, honoring the stated "regain access on" reset; a 403 free-quota
// sentence is quota exhaustion, not a permission error. Synthetic data only.

const CREDIT = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
const usageLimit = (stamp) => `You have reached your specified API usage limits. You will regain access on ${stamp}.`;
const FREE_QUOTA = "The free quota has been exhausted. To continue accessing the model on a paid basis, please complete your payment information.";
const envelope = (message, type = "invalid_request_error") => ({ type: "error", error: { type, message } });
const ANTHROPIC_IDS = ["anthropic", "claude", "anthropic-compatible-team1"];
const NOW = Date.UTC(2026, 10, 28, 0, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const classify = (provider, body, model = "claude-sonnet-4-5") =>
  checkFallbackError({ status: 400, errorText: JSON.stringify(body), structuredError: body, provider, model });

function utcStamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} at ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

describe("Anthropic credit and usage-limit 400 detection", () => {
  it("accepts the three source messages as structured, bare and status-prefixed bodies", () => {
    const limit = usageLimit("2026-12-01 at 00:00 UTC");
    for (const provider of ANTHROPIC_IDS) {
      for (const message of [CREDIT, limit]) {
        for (const body of [envelope(message), envelope(message, "billing_error")]) {
          expect(classify(provider, body), `${provider}: ${message}`).toMatchObject({
            shouldFallback: true, terminal: true, scope: "connection", creditsExhausted: true,
          });
        }
        for (const text of [message, `[400]: ${message}`, `  [400]:   ${message}`]) {
          expect(checkFallbackError(400, text, 0, provider).scope, `${provider}: ${text}`).toBe("connection");
        }
      }
    }
    expect(isAnthropicCreditProvider("Anthropic-Compatible-X")).toBe(true);
  });

  it("rejects echoed, quoted, unrelated and foreign-envelope 400s", () => {
    const limit = usageLimit("2026-12-01 at 00:00 UTC");
    const negatives = [
      envelope(`Unknown parameter: '${limit}'`),
      envelope(`"${limit}" is not a valid value for metadata.user_id`),
      envelope("messages.0.content: Field required"),
      envelope(limit, "api_error"),
      { error: { type: "invalid_request_error", message: limit } },
    ];
    for (const body of negatives) {
      expect(anthropicAccountCreditMessage(JSON.stringify(body), body), JSON.stringify(body)).toBeNull();
      const result = classify("anthropic", body);
      expect(result.scope).not.toBe("connection");
      expect(result.creditsExhausted).toBeUndefined();
    }
    for (const text of [`[400]: Echo: ${limit}`, `[429]: ${limit}`, `prefix ${CREDIT}`]) {
      expect(anthropicAccountCreditMessage(text)).toBeNull();
    }
  });

  it("does not lock a non-Anthropic credential, an aggregator or another status", () => {
    const body = envelope(usageLimit("2026-12-01 at 00:00 UTC"));
    for (const provider of ["openai-compatible-x", "openrouter", "claude-web", "anthropic-ish"]) {
      const result = classify(provider, body, "anthropic/claude-sonnet-4.5");
      expect(result.scope, provider).not.toBe("connection");
      expect(result.creditsExhausted, provider).toBeUndefined();
    }
    // Aggregator passthrough stays request-scoped: no shared-key lock.
    expect(classify("openrouter", body, "anthropic/claude-sonnet-4.5")).toMatchObject({ shouldFallback: false, requestScoped: true });
    expect(checkFallbackError(429, JSON.stringify(body), 0, "anthropic").creditsExhausted).toBeUndefined();
  });
});

describe("Anthropic regain-access reset", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it("pauses until the stated UTC reset, with zone and separator variants", () => {
    const target = Date.UTC(2026, 11, 1, 0, 0, 0);
    const variants = [
      ["2026-12-01 at 00:00 UTC", target],
      ["2026-12-01T00:00Z", target],
      ["2026-12-01 00:00:30 Z", target + 30_000],
      ["2026-12-01 at 02:00 +02:00", target],
      ["2026-12-01 at 02:00 +0200", target],
      ["2026-11-30 at 19:30 -04:30", target],
      ["2026-12-01 at 00:00", target],
    ];
    for (const [stamp, expected] of variants) {
      expect(parseAnthropicRegainAccessResetMs(usageLimit(stamp), NOW), stamp).toBe(expected);
      for (const body of [envelope(usageLimit(stamp)), `[400]: ${usageLimit(stamp)}`]) {
        const result = typeof body === "string" ? checkFallbackError(400, body, 0, "claude") : classify("anthropic", body);
        expect(result, stamp).toMatchObject({
          shouldFallback: true, terminal: true, scope: "connection", creditsExhausted: true,
          cooldownMs: expected - NOW, quotaResetAtMs: expected, retryHintSource: "body_iso_reset",
        });
      }
    }
  });

  it("ignores impossible, past and malformed resets and keeps the terminal default", () => {
    const invalid = [
      "2026-02-30 at 00:00 UTC", "2026-13-01 at 00:00 UTC", "2026-00-10 at 00:00 UTC",
      "2026-12-01 at 24:00 UTC", "2026-12-01 at 10:60 UTC", "2026-12-01 at 10:00:61 UTC",
      "2026-12-01 at 00:00 +15:00", "2026-12-01 at 00:00 +02:75", "2026-11-27 at 23:59 UTC",
      "2026-11-28 at 00:00 UTC", "2026-12-1 at 00:00 UTC", "soon",
    ];
    for (const stamp of invalid) {
      expect(parseAnthropicRegainAccessResetMs(usageLimit(stamp), NOW), stamp).toBeNull();
      const result = classify("anthropic", envelope(usageLimit(stamp)));
      expect(result, stamp).toMatchObject({ terminal: true, scope: "connection", cooldownMs: COOLDOWN_MS.paymentRequired });
      expect(result.quotaResetAtMs, stamp).toBeUndefined();
      expect(result.retryHintSource, stamp).toBeUndefined();
    }
    // The credit message states no reset: the existing terminal cooldown applies.
    expect(classify("anthropic", envelope(CREDIT)).cooldownMs).toBe(COOLDOWN_MS.paymentRequired);
  });

  it("clamps a far reset to the configured maximum cooldown", () => {
    const result = classify("anthropic", envelope(usageLimit("2027-06-01 at 00:00 UTC")));
    expect(result.cooldownMs).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);
    expect(result.quotaResetAtMs).toBe(NOW + MAX_RATE_LIMIT_COOLDOWN_MS);
  });

  it("does not let a trailing short retry hint replace the reset", () => {
    const result = checkFallbackError(400, `[400]: ${usageLimit("2026-12-01 at 00:00 UTC")} Please retry in 60s.`, 0, "anthropic");
    expect(result.cooldownMs).toBe(3 * DAY);
  });
});

describe("account fallback and selection through the local database", () => {
  let tempDir;
  let saved;

  beforeEach(() => {
    saved = { DATA_DIR: process.env.DATA_DIR, HOME: process.env.HOME };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-21440-"));
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
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function seed(provider, names) {
    const localDb = await import("@/lib/localDb");
    const ids = [];
    for (const [index, name] of names.entries()) {
      const conn = await localDb.createProviderConnection({
        provider, authType: "apikey", name, apiKey: `synthetic-${name}`, isActive: true, testStatus: "active", priority: index + 1,
      });
      ids.push(conn.id);
    }
    return { localDb, ids };
  }

  it("parks the first Anthropic key until the stated reset and selects the second", async () => {
    const { markAccountUnavailable, getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const { localDb, ids: [first, second] } = await seed("anthropic", ["anthropic-a", "anthropic-b"]);
    // Minute precision, as Anthropic states it; three days ahead of the real clock.
    const resetAt = Math.floor((Date.now() + 3 * DAY) / 60_000) * 60_000;
    const body = envelope(usageLimit(utcStamp(resetAt)));

    const result = await markAccountUnavailable(
      first, 400, `[400]: ${body.error.message} Please retry in 60s.`, "anthropic", "claude-sonnet-4-5",
      // A short caller hint (Retry-After) must not shorten the billing pause.
      Date.now() + 60_000,
      { attemptStartedAt: Date.now(), errorBody: body },
    );
    expect(result.shouldFallback).toBe(true);
    expect(Math.abs(result.cooldownMs - (resetAt - Date.now()))).toBeLessThan(5_000);

    const stored = await localDb.getProviderConnectionById(first);
    for (const model of ["claude-sonnet-4-5", "claude-opus-4-6", "claude-haiku-4-5"]) {
      expect(isModelLockActive(stored, model), model).toBe(true);
    }
    expect(stored.quotaLockout).toBeFalsy();
    expect(Math.abs(Date.parse(stored.modelLock___all) - resetAt)).toBeLessThan(5_000);

    for (const model of ["claude-sonnet-4-5", "claude-opus-4-6"]) {
      const picked = await getProviderCredentials("anthropic", null, model);
      expect(picked?.connectionId, model).toBe(second);
    }
    const untouched = await localDb.getProviderConnectionById(second);
    expect(Object.keys(untouched).filter((key) => key.startsWith("modelLock_") && untouched[key])).toEqual([]);
  });

  it("keeps the terminal cooldown when only a short hint and no reset are present", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const { ids: [first] } = await seed("anthropic-compatible-team1", ["compat-a", "compat-b"]);
    const body = envelope(CREDIT);
    const result = await markAccountUnavailable(
      first, 400, `[400]: ${CREDIT}`, "anthropic-compatible-team1", "claude-sonnet-4-5",
      Date.now() + 5_000, { attemptStartedAt: Date.now(), errorBody: body },
    );
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(COOLDOWN_MS.paymentRequired);
  });

  it("leaves both keys usable after an echoed usage-limit 400", async () => {
    const { markAccountUnavailable, getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const { localDb, ids: [first] } = await seed("anthropic", ["anthropic-a", "anthropic-b"]);
    const body = envelope(`Unknown parameter: '${usageLimit("2026-12-01 at 00:00 UTC")}'`);
    const result = await markAccountUnavailable(
      first, 400, `[400]: ${body.error.message}`, "anthropic", "claude-sonnet-4-5", null,
      { attemptStartedAt: Date.now(), errorBody: body },
    );
    expect(result.shouldFallback).toBe(false);
    const stored = await localDb.getProviderConnectionById(first);
    expect(isModelLockActive(stored, "claude-sonnet-4-5")).toBe(false);
    expect((await getProviderCredentials("anthropic", null, "claude-sonnet-4-5"))?.connectionId).toBe(first);
  });

  it("locks a 403 free-quota key, prefixed or structured, and selects its sibling", async () => {
    const { markAccountUnavailable, getProviderCredentials } = await import("../../src/sse/services/auth.js");
    const { localDb, ids: [first, second] } = await seed("openai-compatible-free", ["free-a", "free-b"]);
    await markAccountUnavailable(first, 403, `[403]: ${FREE_QUOTA}`, "openai-compatible-free", "qwen-max", null, { attemptStartedAt: Date.now() });
    expect((await localDb.getProviderConnectionById(first)).quotaLockout).toMatchObject({ status: "quota_exhausted", source: "auto" });
    expect((await getProviderCredentials("openai-compatible-free", null, "qwen-max"))?.connectionId).toBe(second);

    const structured = { error: { message: FREE_QUOTA, code: "AllocationQuota.FreeTierOnly" } };
    await markAccountUnavailable(second, 403, `[403]: ${FREE_QUOTA}`, "openai-compatible-free", "qwen-max", null, { attemptStartedAt: Date.now(), errorBody: structured });
    expect((await localDb.getProviderConnectionById(second)).quotaLockout?.status).toBe("quota_exhausted");
  });

  it("keeps 403 permission and wrong-product errors off the quota lockout", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const { localDb, ids: [first] } = await seed("openai-compatible-free", ["free-a"]);
    const negatives = [
      "[403]: Your API key does not have permission to access this resource.",
      "[403]: This model is not available for your product. Enable it in the console.",
      "[403]: Access denied: the free quota feature is not part of your plan.",
      `[403]: Request rejected because the prompt says "${FREE_QUOTA}"`,
    ];
    for (const text of negatives) {
      await markAccountUnavailable(first, 403, text, "openai-compatible-free", "qwen-max", null, { attemptStartedAt: Date.now() });
      expect((await localDb.getProviderConnectionById(first)).quotaLockout ?? null, text).toBeNull();
    }
  });
});

describe("combo fallback", () => {
  it("advances past an Anthropic usage-limit member without advertising a retry", async () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["anthropic/claude-sonnet-4-5", "openai/gpt-5-mini"];
    const failure = Response.json(envelope(usageLimit("2099-01-01 at 00:00 UTC")), { status: 400 });
    const success = Response.json({ choices: [{ message: { content: "Hello" } }] });
    const handleSingleModel = vi.fn().mockResolvedValueOnce(failure).mockResolvedValueOnce(success);
    const response = await handleComboChat({
      body, models, handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "usage-limit", comboStrategy: "fallback",
    });
    expect(response).toBe(success);
    expect(handleSingleModel.mock.calls.map((call) => call[1])).toEqual(models);
  });
});
