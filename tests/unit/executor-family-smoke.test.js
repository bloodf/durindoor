import { describe, it, expect, vi } from "vitest";

// Both the Ollama and Antigravity usage handlers call proxyAwareFetch, not the
// global fetch, so the smoke has to intercept that module to exercise them.
const proxyMock = vi.hoisted(() => ({ impl: null }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => proxyMock.impl(...args),
}));
// Executor-family smoke: drive each family this campaign touched through its
// real code path with the transport mocked, printing the observed values so a
// green run shows what actually happened rather than only that nothing threw.

const { getExecutor } = await import("../../open-sse/executors/index.js");
const { getOllamaUsage } = await import("../../open-sse/services/usage/misc.js");
const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
const { resolveOpenAiEffort } = await import("../../open-sse/translator/concerns/thinkingUnified.js");
const { runBackgroundTokenRefreshTick } = await import("../../src/sse/services/backgroundTokenRefresh.js");

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

// ── Codex family: effort resolution + request transform ─────────────────────
try {
  const codex = getExecutor("codex");
  const body = {
    model: "gpt-5.6-sol",
    messages: [{ role: "user", content: "ping" }],
    reasoning_effort: "ultra",
  };
  const out = codex.transformRequest?.("gpt-5.6-sol", structuredClone(body), true) ?? body;
  const semantic = resolveOpenAiEffort("ultra", "codex", "gpt-5.6-sol");
  const wire = out?.reasoning?.effort;
  // Sol supports ultra semantically; the registry alias maps it to "max" on the
  // wire. Both exact values matter — asserting only "not undefined" would stay
  // green even if the transform stopped setting reasoning at all.
  record(
    "codex: ultra resolves semantically and maps to max on the wire",
    semantic === "ultra" && wire === "max",
    `semantic=${semantic} wireEffort=${JSON.stringify(wire)} (expected semantic=ultra wireEffort="max")`,
  );
} catch (e) {
  record("codex", false, `threw: ${e.message}`);
}

// ── Ollama family: usage round trip with the transport mocked ───────────────
try {
  proxyMock.impl = async (url) => {
    const u = String(url);
    if (u.includes("ollama.com/api/usage")) {
      return new Response(JSON.stringify({ limits: { session: { usage: 0.25 }, weekly: { usage: 0.8 } } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("ollama.com/api/me")) {
      return new Response(JSON.stringify({ Plan: "pro" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected ollama url ${u}`);
  };
  const usage = await getOllamaUsage("smoke-key", {});
  const s = usage?.quotas?.["Session (5h)"];
  const w = usage?.quotas?.["Weekly (7d)"];
  record(
    "ollama: usage API produces session + weekly quota bars",
    usage.plan === "Pro" && s?.remainingPercentage === 75 && w?.remainingPercentage === 20,
    `plan=${usage.plan} session=${JSON.stringify(s)} weekly=${JSON.stringify(w)}`,
  );
} catch (e) {
  record("ollama", false, `threw: ${e.message}`);
}

// ── Antigravity family: 3.6 quota bars come through the usage handler ───────
try {
  proxyMock.impl = async (url) => {
    const u = String(url);
    if (u.includes(":loadCodeAssist")) {
      return new Response(JSON.stringify({ cloudaicompanionProject: "p1", currentTier: { name: "Pro" } }), { status: 200 });
    }
    if (u.includes("googleapis.com")) {
      return new Response(JSON.stringify({
        models: {
          "gemini-3.6-flash-high": { displayName: "Gemini 3.6 Flash (High)", quotaInfo: { remainingFraction: 0.8 } },
          "gemini-3.6-flash-low": { displayName: "Gemini 3.6 Flash (Low)", quotaInfo: { remainingFraction: 0.2 } },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected antigravity url ${u}`);
  };
  const usage = await getAntigravityUsage("smoke-token", {});
  const hi = usage?.quotas?.["gemini-3.6-flash-high"];
  record(
    "antigravity: Gemini 3.6 Flash tiers render usage bars",
    hi?.remainingPercentage === 80,
    `quotas=${JSON.stringify(Object.keys(usage?.quotas ?? {}))} high=${JSON.stringify(hi)}`,
  );
} catch (e) {
  record("antigravity", false, `threw: ${e.message}`);
}

// ── GitHub family: executor builds a request without throwing ───────────────
try {
  const gh = getExecutor("github");
  const url = gh.buildUrl?.("gpt-4o", true, 0, { apiKey: "smoke" });
  const headers = gh.buildHeaders?.({ apiKey: "smoke", accessToken: "smoke" }, true) ?? {};
  record(
    "github: executor resolves an upstream URL and auth headers",
    typeof url === "string" && url.length > 0 && Object.keys(headers).length > 0,
    `url=${url} headerKeys=${JSON.stringify(Object.keys(headers))}`,
  );
} catch (e) {
  record("github", false, `threw: ${e.message}`);
}

// ── Background refresh scheduler: a tick runs and is fail-open ──────────────
try {
  let refreshed = 0;
  await runBackgroundTokenRefreshTick({
    loadConnections: async () => ([
      { id: "c1", provider: "codex", authType: "oauth", refreshToken: "r", expiresAt: new Date(Date.now() + 60_000).toISOString() },
      { id: "c2", provider: "github", authType: "oauth", refreshToken: "r", expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      { id: "c3", provider: "codex", authType: "apikey" },
    ]),
    refreshConnection: async (c) => { refreshed++; if (c.id === "c1") throw new Error("simulated provider failure"); },
  });
  record(
    "background refresh: selects only due OAuth connections and swallows failures",
    refreshed === 1,
    `refreshAttempts=${refreshed} (expected 1: c1 due, c2 far future, c3 not oauth)`,
  );
} catch (e) {
  record("background refresh", false, `tick threw (must be fail-open): ${e.message}`);
}


describe("executor family smoke", () => {
  for (const r of results) {
    it(r.name, () => {
      expect(r.ok, r.detail).toBe(true);
    });
  }
});
