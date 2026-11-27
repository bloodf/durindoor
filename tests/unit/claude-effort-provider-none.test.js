// DurinDoor #2640 review: provider thinking mode `none` strips the request's
// thinking fields before chatCore computes the catalog-resolved effort, so the
// body alone looked "unset" and a `-high` suffix re-enabled thinking. Provider
// `none`/`off` must stay authoritative over a resolved `-<effort>` suffix,
// while explicit request fields, provider levels, literal IDs and `(level)`
// suffixes keep their precedence. #2676: `none` also strips every other
// accepted thinking/effort shape, and `off` drops output_config.effort when it
// injects a disable. Offline: settings and fetch are fixtures.
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
const { catalogEffortIntent, extractThinking } = await import("../../open-sse/translator/concerns/thinkingUnified.js");
const { applyProviderThinkingOverride } = await import("../../open-sse/config/providerModels.js");
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

// DurinDoor #2676: provider `none` used to strip thinking/reasoning_effort/
// reasoning but leave a client's Claude `output_config.effort`, which turned
// adaptive thinking back on even for a literal model. `none` now strips every
// shape extractThinking accepts and keeps unrelated output_config fields.
describe("provider none and a client output_config.effort (#2676)", () => {
  beforeEach(() => proxyAwareFetch.mockReset());

  it("literal model: provider none drops a client output_config.effort", async () => {
    expectThinkingOff(await viaChatCore({ output_config: { effort: "low" } }, { mode: "none" }, { provider: "anthropic", model: BASE }));
    expectThinkingOff(await viaChatCore({ output_config: { effort: "max" }, thinking: { type: "adaptive" } }, { mode: "none" }, { provider: "anthropic", model: BASE }));
  });

  it("resolved suffix: neither the client effort nor the suffix effort survives", async () => {
    expectThinkingOff(await viaChatCore({ output_config: { effort: "low" } }, { mode: "none" }));
  });

  it("keeps unrelated output_config fields", async () => {
    const format = { type: "json_schema", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false } };
    const sent = await viaChatCore({ output_config: { effort: "high", format } }, { mode: "none" }, { provider: "anthropic", model: BASE });
    expectThinkingOff(sent);
    expect(sent.output_config).toEqual({ format });
  });

  it("dispatch reads provider none from settings and drops output_config.effort", async () => {
    expectThinkingOff(await viaDispatch({ output_config: { effort: "high" } }, { mode: "none" }));
    expectThinkingOff(await viaDispatch({ output_config: { effort: "low" }, reasoningEffort: "high" }, { mode: "none" }));
  });

  it("keeps the documented model(level) suffix precedence over provider none", async () => {
    const sent = await viaChatCore({ output_config: { effort: "low" } }, { mode: "none" }, { provider: "anthropic", model: `${BASE}(high)` });
    expect(sent.model).toBe(BASE);
    expect(sent.output_config?.effort).toBe("high");
  });

  it("dispatch without a disabling setting still forwards the client effort", async () => {
    expect((await viaDispatch({ output_config: { effort: "low" } }, null)).output_config?.effort).toBe("low");
    expect((await viaDispatch({ output_config: { effort: "low" } }, { mode: "auto" })).output_config?.effort).toBe("low");
  });
});

describe("applyProviderThinkingOverride none strips every accepted shape", () => {
  const none = { mode: "none" };

  it("removes Claude, OpenAI, Responses, Ollama and Qwen controls", () => {
    const body = {
      model: "m", messages: [],
      thinking: { type: "enabled", budget_tokens: 2048 },
      output_config: { effort: "high" },
      reasoning_effort: "high", reasoningEffort: "high", reasoning: { effort: "high", summary: "auto" },
      think: true, enable_thinking: true, thinking_budget: 4096,
      thinkingLevel: "high", thinking_level: "high",
    };
    const out = applyProviderThinkingOverride(body, none);
    expect(out).toEqual({ model: "m", messages: [] });
    expect(extractThinking(out)).toBeNull();
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("removes Gemini thinking configs at every path and keeps the rest", () => {
    const body = {
      thinkingConfig: { thinkingBudget: 1024 },
      thinking_config: { thinking_level: "high" },
      generationConfig: { temperature: 0.2, thinkingConfig: { thinkingLevel: "high" } },
      generation_config: { thinking_config: { thinking_budget: -1 } },
      request: {
        contents: [],
        thinkingConfig: { thinkingBudget: 1 },
        generationConfig: { maxOutputTokens: 10, thinking_config: { thinkingBudget: 2048 } },
      },
    };
    const out = applyProviderThinkingOverride(body, none);
    expect(out).toEqual({
      generationConfig: { temperature: 0.2 },
      request: { contents: [], generationConfig: { maxOutputTokens: 10 } },
    });
    expect(extractThinking(out, "gemini-3-pro", "gemini")).toBeNull();
  });

  it("returns the same body when nothing names thinking", () => {
    const body = { model: "m", output_config: { format: { type: "json_schema" } }, generationConfig: { temperature: 1 } };
    expect(applyProviderThinkingOverride(body, none)).toBe(body);
  });

  it("leaves auto alone and keeps an explicit client thinking under off", () => {
    const body = { output_config: { effort: "low" } };
    expect(applyProviderThinkingOverride(body, { mode: "auto" })).toBe(body);
    const explicit = { thinking: { type: "adaptive" }, output_config: { effort: "low" } };
    expect(applyProviderThinkingOverride(explicit, { mode: "off" })).toBe(explicit);
  });

  it("off injects disabled and drops only output_config.effort", () => {
    expect(applyProviderThinkingOverride({ output_config: { effort: "low" } }, { mode: "off" })).toEqual({ thinking: { type: "disabled" } });
    expect(applyProviderThinkingOverride({ output_config: { effort: "low", format: { type: "json_schema" } } }, { mode: "off" }))
      .toEqual({ output_config: { format: { type: "json_schema" } }, thinking: { type: "disabled" } });
  });
});

describe("provider off and a client effort (#2676 review)", () => {
  beforeEach(() => proxyAwareFetch.mockReset());

  it("keeps thinking disabled against output_config.effort and reasoning_effort", async () => {
    const literal = { provider: "anthropic", model: BASE };
    const viaEffort = await viaChatCore({ output_config: { effort: "low" } }, { mode: "off" }, literal);
    expectThinkingOff(viaEffort);
    expect(viaEffort.thinking).toEqual({ type: "disabled" });
    expectThinkingOff(await viaChatCore({ reasoning_effort: "high" }, { mode: "off" }, literal));
    expectThinkingOff(await viaDispatch({ output_config: { effort: "high" } }, { mode: "off" }));
  });
});
