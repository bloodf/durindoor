// Port of OmniRoute #6818 — Antigravity weekly-quota surface.
//
// Antigravity enforces both a 5-hour window (already surfaced per-model via
// `fetchAvailableModels`) and a separate weekly window that only appears in the
// `retrieveUserQuotaSummary` RPC, grouped by model family ("Gemini Models",
// "Claude and GPT models") rather than by individual modelId. Guards:
//  1. The pure parser (`parseAntigravityWeeklyQuotas`) against the documented
//     bucket shape — weekly picked per group, 5h bucket never misclassified,
//     missing/partial payloads yield `{}` instead of fabricated depleted quotas.
//  2. The end-to-end wiring: `getAntigravityUsage()` merges weekly group quotas
//     alongside the existing per-model 5h quotas, best-effort — an unavailable
//     summary RPC leaves the 5h rows untouched.
import { describe, it, expect, vi, beforeEach } from "vitest";

const proxyAwareFetch = vi.fn();
// Safe default: module-load side-effect fetches (kimchiUserAgent updater) hit the mock
// before any test sets an implementation — never return undefined.
proxyAwareFetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const RESET_IN_3_DAYS = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const RESET_IN_2_HOURS = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

const { getAntigravityUsage, parseAntigravityWeeklyQuotas } = await import("../../open-sse/services/usage/google.js");
const { getUsageForProvider } = await import("../../open-sse/services/usage.js");

function summaryResponse(groups) {
  return { ok: true, status: 200, json: async () => ({ groups }), text: async () => "{}" };
}

describe("parseAntigravityWeeklyQuotas", () => {
  it("extracts the weekly bucket per model-family group, never the 5h bucket", () => {
    const quotas = parseAntigravityWeeklyQuotas({
      groups: [
        {
          displayName: "Gemini Models",
          buckets: [
            { bucketId: "gemini-5h", displayName: "5 Hour Quota", remainingFraction: 0.4, resetTime: RESET_IN_2_HOURS },
            { bucketId: "gemini-weekly", displayName: "Weekly Quota", remainingFraction: 0.75, resetTime: RESET_IN_3_DAYS },
          ],
        },
        {
          displayName: "Claude and GPT models",
          buckets: [
            { bucketId: "claude-gpt-weekly", displayName: "Weekly Quota", remainingFraction: 0.1, resetTime: RESET_IN_3_DAYS },
          ],
        },
      ],
    });

    expect(quotas.gemini_weekly).toMatchObject({
      remainingPercentage: 75,
      resetAt: RESET_IN_3_DAYS,
      unlimited: false,
      displayName: "Gemini Weekly",
    });
    expect(quotas.claude_gpt_weekly).toMatchObject({
      remainingPercentage: 10,
      displayName: "Claude & GPT Weekly",
    });
    // Exactly one entry per group — the 5h bucket must not be picked up.
    expect(Object.keys(quotas).sort()).toEqual(["claude_gpt_weekly", "gemini_weekly"]);
  });

  it("tolerates the quotaSummary-nested envelope", () => {
    const quotas = parseAntigravityWeeklyQuotas({
      quotaSummary: {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [{ bucketId: "weekly", displayName: "Weekly", remainingFraction: 0.5, resetTime: RESET_IN_3_DAYS }],
          },
        ],
      },
    });
    expect(quotas.gemini_weekly?.remainingPercentage).toBe(50);
  });

  it("returns {} for missing/malformed payloads (best-effort)", () => {
    expect(parseAntigravityWeeklyQuotas(null)).toEqual({});
    expect(parseAntigravityWeeklyQuotas(undefined)).toEqual({});
    expect(parseAntigravityWeeklyQuotas({})).toEqual({});
    expect(parseAntigravityWeeklyQuotas({ groups: [{ displayName: "Gemini Models" }] })).toEqual({});
    expect(parseAntigravityWeeklyQuotas({ groups: "not-an-array" })).toEqual({});
  });

  it("skips partial buckets — null/blank remainingFraction must not fabricate a depleted quota", () => {
    const base = { bucketId: "gemini-weekly", displayName: "Weekly Quota", resetTime: RESET_IN_3_DAYS };
    for (const bad of [null, "", "   ", undefined, "nope", -0.5]) {
      const quotas = parseAntigravityWeeklyQuotas({
        groups: [{ displayName: "Gemini Models", buckets: [{ ...base, remainingFraction: bad }] }],
      });
      expect(quotas).toEqual({});
    }
    // A genuine 0 IS data (fully depleted) — must be kept.
    const depleted = parseAntigravityWeeklyQuotas({
      groups: [{ displayName: "Gemini Models", buckets: [{ ...base, remainingFraction: 0 }] }],
    });
    expect(depleted.gemini_weekly?.remainingPercentage).toBe(0);
  });

  it("skips disabled weekly buckets", () => {
    const quotas = parseAntigravityWeeklyQuotas({
      groups: [
        {
          displayName: "Gemini Models",
          buckets: [{ bucketId: "gemini-weekly", displayName: "Weekly Quota", remainingFraction: 0.5, disabled: true }],
        },
      ],
    });
    expect(quotas).toEqual({});
  });
});

describe("getAntigravityUsage weekly merge", () => {
  beforeEach(() => proxyAwareFetch.mockReset());

  function mockNetwork({ summary }) {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (typeof url !== "string") {
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
      }
      if (url.includes(":loadCodeAssist")) {
        return { ok: true, status: 200, json: async () => ({ cloudaicompanionProject: "project-1", currentTier: { name: "Pro" } }), text: async () => "{}" };
      }
      if (url.includes("retrieveUserQuotaSummary")) {
        return summary;
      }
      // retrieveUserQuota (5h per-model)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: {
            "gemini-3-flash": { quotaInfo: { remainingFraction: 0.4, resetTime: RESET_IN_2_HOURS } },
          },
        }),
        text: async () => "{}",
      };
    });
  }

  it("merges weekly group quotas alongside per-model 5h quotas without clobbering them", async () => {
    mockNetwork({
      summary: summaryResponse([
        {
          displayName: "Gemini Models",
          buckets: [{ bucketId: "gemini-weekly", displayName: "Weekly Quota", remainingFraction: 0.6, resetTime: RESET_IN_3_DAYS }],
        },
      ]),
    });

    const result = await getAntigravityUsage("token-weekly-merge", {});

    // Existing per-model 5h quota untouched.
    expect(result.quotas["gemini-3-flash"]).toMatchObject({ remainingPercentage: 40 });
    // Weekly row surfaced alongside.
    expect(result.quotas.gemini_weekly).toMatchObject({
      remainingPercentage: 60,
      resetAt: RESET_IN_3_DAYS,
      displayName: "Gemini Weekly",
    });

    // The summary RPC carries the same official IDE headers as the other calls.
    const summaryCall = proxyAwareFetch.mock.calls.find(([url]) => url.includes("retrieveUserQuotaSummary"));
    expect(summaryCall).toBeDefined();
    expect(summaryCall[1].headers["User-Agent"]).toBe("antigravity/ide/2.1.1 darwin/arm64");
    expect(summaryCall[1].headers).not.toHaveProperty("x-request-source");
  });

  it("is unaffected when retrieveUserQuotaSummary is unavailable (404)", async () => {
    mockNetwork({ summary: { ok: false, status: 404, json: async () => ({}), text: async () => "{}" } });

    const result = await getAntigravityUsage("token-weekly-unavailable", {});

    expect(result.quotas["gemini-3-flash"]).toBeDefined();
    expect(result.quotas.gemini_weekly).toBeUndefined();
  });

  it("skips the summary RPC gracefully when no project id resolves (null project → no weekly)", async () => {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (typeof url !== "string") {
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
      }
      if (url.includes(":loadCodeAssist")) {
        return { ok: true, status: 200, json: async () => ({ currentTier: { name: "Free" } }), text: async () => "{}" };
      }
      if (url.includes("retrieveUserQuotaSummary")) {
        throw new Error("must not be called without project");
      }
      return { ok: true, status: 200, json: async () => ({ models: { "gemini-3-flash": { quotaInfo: { remainingFraction: 0.9, resetTime: RESET_IN_2_HOURS } } } }), text: async () => "{}" };
    });

    const result = await getAntigravityUsage("token-weekly-noproject", {});
    expect(result.quotas["gemini-3-flash"]).toBeDefined();
    expect(result.quotas.gemini_weekly).toBeUndefined();
  });

  it("routes the connection-level projectId to the weekly RPC through getUsageForProvider", async () => {
    // loadCodeAssist returns NO project (partial payload) — the connection-stored
    // top-level projectId must flow: usage.js → providerDataWithProjectId → summary body.
    proxyAwareFetch.mockImplementation(async (url) => {
      // Module-load side-effect fetches (e.g. kimchiUserAgent update) may pass a
      // non-string URL — treat those as opaque 200s.
      if (typeof url !== "string") {
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
      }
      if (url.includes(":loadCodeAssist")) {
        return { ok: true, status: 200, json: async () => ({ currentTier: { name: "Pro" } }), text: async () => "{}" };
      }
      if (url.includes("retrieveUserQuotaSummary")) {
        return summaryResponse([
          {
            displayName: "Gemini Models",
            buckets: [{ bucketId: "gemini-weekly", displayName: "Weekly Quota", remainingFraction: 0.5, resetTime: RESET_IN_3_DAYS }],
          },
        ]);
      }
      return { ok: true, status: 200, json: async () => ({ models: {} }), text: async () => "{}" };
    });

    const result = await getUsageForProvider({
      id: "conn-weekly-dispatch",
      provider: "antigravity",
      accessToken: "token-weekly-dispatch",
      providerSpecificData: {},
      projectId: "stored-project-9",
    });

    const summaryCall = proxyAwareFetch.mock.calls.find(([url]) => url.includes("retrieveUserQuotaSummary"));
    expect(summaryCall, "summary RPC called even when load payload lacks project").toBeDefined();
    expect(JSON.parse(summaryCall[1].body)).toEqual({ project: "stored-project-9" });
    expect(result.quotas.gemini_weekly?.remainingPercentage).toBe(50);
  });
});
