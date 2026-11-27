// DurinDoor #2640 review: provider thinking mode `none` strips the request's
// thinking fields before chatCore computes the catalog-resolved effort, so the
// body alone looked "unset" and a `-high` suffix re-enabled thinking. Provider
// `none`/`off` must stay authoritative over a resolved `-<effort>` suffix,
// while explicit request fields, provider levels, literal IDs and `(level)`
// suffixes keep their precedence. Offline: settings and fetch are fixtures.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const { proxyAwareFetch, settings } = vi.hoisted(() => {
  vi.stubGlobal("fetch", async (url) => { throw new Error(`unexpected fetch: ${url}`); });
  return { proxyAwareFetch: vi.fn(), settings: { value: {} } };
});
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch,
}));
vi.mock("@/lib/localDb", async (importOriginal) => ({
  ...(await importOriginal()),
  getSettings: async () => settings.value,
  updateProviderConnection: vi.fn(async () => null),
}));
// Run the attempt once, without the recovery wrapper's DB lookups.
vi.mock("@/lib/routing/connectionRecovery.js", () => ({
  runWithConnectionRecovery: (fn, options) => fn(options),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { dispatchAttempt } = await import("../../src/sse/handlers/chat/singleModel/dispatch.js");
const { catalogEffortIntent } = await import("../../open-sse/translator/concerns/thinkingUnified.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

const BASE = "claude-haiku-9.9";
const RESOLVED = { provider: "anthropic", model: BASE, resolvedThinkingEffort: "high" };

function reply() {
  proxyAwareFetch.mockResolvedValueOnce(Response.json({
    id: "msg_1", type: "message", role: "assistant", model: BASE, stop_reason: "end_turn",
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}

function lastWireBody() {
  const [, options] = proxyAwareFetch.mock.calls.at(-1);
  return JSON.parse(options.body);
}

function requestBody(extra = {}) {
  return { model: `anthropic/${BASE}`, max_tokens: 1024, stream: false, messages: [{ role: "user", content: "hi" }], ...extra };
}

async function viaChatCore(extra, providerThinking, modelInfo = RESOLVED) {
  reply();
  const body = requestBody(extra);
  const result = await handleChatCore({
    body,
    modelInfo,
    providerThinking,
    credentials: { apiKey: "sk-test", providerSpecificData: {} },
    connectionId: "provider-none",
    sourceFormatOverride: FORMATS.CLAUDE,
    clientRawRequest: { endpoint: "/v1/messages", body, headers: { accept: "application/json" } },
  });
  expect(result.success, JSON.stringify(result.error ?? null)).toBe(true);
  return lastWireBody();
}

async function viaDispatch(extra, providerThinking) {
  settings.value = providerThinking ? { providerThinking: { anthropic: providerThinking } } : {};
  reply();
  const body = requestBody(extra);
  const credentials = { connectionId: "provider-none", provider: "anthropic", apiKey: "sk-test", providerSpecificData: {} };
  const ctx = {
    provider: "anthropic",
    model: BASE,
    body,
    modelInfo: RESOLVED,
    request: { url: "http://localhost/v1/messages" },
    clientRawRequest: { endpoint: "/v1/messages", body, headers: { accept: "application/json" } },
  };
  const outcome = await dispatchAttempt(ctx, { excludeConnectionIds: new Set(), accountAttempts: 0 }, {
    credentials,
    refreshedCredentials: { ...credentials },
    activeConnection: { id: "provider-none", provider: "anthropic", authType: "apikey" },
  });
  expect(outcome.value?.result?.success ?? outcome.result?.success, JSON.stringify(outcome)).toBe(true);
  return lastWireBody();
}

/** No thinking control of any shape reached the wire. */
function expectThinkingOff(sent) {
  expect(sent.model).toBe(BASE);
  expect(sent.output_config?.effort).toBeUndefined();
  expect(sent.reasoning_effort).toBeUndefined();
  if (sent.thinking) expect(sent.thinking.type).toBe("disabled");
}

describe("catalogEffortIntent precedence", () => {
  it("drops the resolved effort under provider none/off even on an empty body", () => {
    expect(catalogEffortIntent({}, "high", { mode: "none" })).toBeNull();
    expect(catalogEffortIntent({}, "high", { mode: "off" })).toBeNull();
    // Provider auto/on and levels do not disable thinking, so the body decides.
    expect(catalogEffortIntent({}, "high", { mode: "auto" })).toEqual({ mode: "level", level: "high" });
    expect(catalogEffortIntent({ reasoning_effort: "low" }, "high", { mode: "low" })).toBeNull();
    expect(catalogEffortIntent({}, "high", null)).toEqual({ mode: "level", level: "high" });
  });
});

describe("provider thinking none against a resolved effort suffix (chatCore)", () => {
  beforeEach(() => proxyAwareFetch.mockReset());

  it("keeps thinking off for a bare request", async () => {
    expectThinkingOff(await viaChatCore({}, { mode: "none" }));
  });

  it("keeps thinking off when the request also asked for thinking (none strips it)", async () => {
    // output_config is not one of the fields provider none strips, so it is
    // left out here; this case covers only what the resolved effort could revive.
    expectThinkingOff(await viaChatCore({ thinking: { type: "adaptive" } }, { mode: "none" }));
    expectThinkingOff(await viaChatCore({ thinking: { type: "enabled", budget_tokens: 4096 } }, { mode: "none" }));
    expectThinkingOff(await viaChatCore({ reasoning_effort: "medium" }, { mode: "none" }));
  });

  it("keeps thinking off under provider off", async () => {
    expectThinkingOff(await viaChatCore({}, { mode: "off" }));
  });

  it("still applies the resolved effort without a disabling provider setting", async () => {
    expect((await viaChatCore({}, null)).output_config?.effort).toBe("high");
    expect((await viaChatCore({}, { mode: "auto" })).output_config?.effort).toBe("high");
  });

  it("lets a provider level win over the resolved effort", async () => {
    expect((await viaChatCore({}, { mode: "low" })).output_config?.effort).toBe("low");
  });

  it("lets explicit request fields win when the provider does not disable thinking", async () => {
    expect((await viaChatCore({ output_config: { effort: "medium" } }, null)).output_config?.effort).toBe("medium");
  });

  it("leaves a literal model without a resolved effort untouched under none", async () => {
    expectThinkingOff(await viaChatCore({}, { mode: "none" }, { provider: "anthropic", model: BASE }));
  });
});

describe("provider thinking none against a resolved effort suffix (dispatch)", () => {
  beforeEach(() => proxyAwareFetch.mockReset());

  it("reads provider none from settings and keeps thinking off", async () => {
    expectThinkingOff(await viaDispatch({}, { mode: "none" }));
    expectThinkingOff(await viaDispatch({ reasoning_effort: "high" }, { mode: "none" }));
  });

  it("forwards the resolved effort when settings leave thinking alone", async () => {
    expect((await viaDispatch({}, null)).output_config?.effort).toBe("high");
    expect((await viaDispatch({}, { mode: "medium" })).output_config?.effort).toBe("medium");
  });
});

// Pre-existing gap, separate from #2640 and reproduced without any resolved
// suffix: provider `none` strips thinking/reasoning_effort/reasoning but not a
// client's Claude `output_config.effort`, which then turns adaptive thinking
// back on. That contradicts applyProviderThinkingOverride's "strip thinking
// params entirely" intent. Kept as an expected failure so the reproduction
// stays concrete; when the gap is fixed this flips red and should become a
// plain `it`.
describe("provider none and a client output_config.effort (pre-existing)", () => {
  beforeEach(() => proxyAwareFetch.mockReset());

  it.fails("REPRO: literal model, provider none, client output_config.effort still enables thinking", async () => {
    expectThinkingOff(await viaChatCore({ output_config: { effort: "low" } }, { mode: "none" }, { provider: "anthropic", model: BASE }));
  });

  it("never applies the resolved suffix effort in that case", async () => {
    const sent = await viaChatCore({ output_config: { effort: "low" } }, { mode: "none" });
    expect(sent.output_config?.effort).toBe("low");
  });
});
