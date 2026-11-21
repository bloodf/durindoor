// #1073 / OmniRoute #18760: an explicit provider safety or refusal stop that
// arrives inside a stream is the provider's terminal answer. It must reach the
// client once and must not be replayed on a sibling model or account.
//
// Offline only: every stream below is a synthetic provider frame sequence and
// every "provider" is a local mock. Empty streams, transport errors and error
// envelopes are controls that keep their existing fallback behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
}));
vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  loadCustomCapabilities: async () => null,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(),
  getProviderCredentialsWithQuotaPreflight: vi.fn(),
  projectProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  evaluateApiKeyAuth: vi.fn(),
  resolveClientApiKey: vi.fn(),
  providerAllowsPublicNoAuthFallback: vi.fn(() => false),
}));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: vi.fn() }));
vi.mock("@/shared/services/providerQuotaTracker", () => ({ refreshProviderQuota: vi.fn() }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({ handleChatCore: vi.fn() }));
vi.mock("../../open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: vi.fn(async () => null) }));

const { holdForEarlyEof } = await import("../../src/sse/handlers/chat.js");
const { getComboModelQuotaHealth, handleComboChat, resetComboScoring } = await import("../../open-sse/services/combo.js");
const { frameCarriesContent, peekStreamForContent } = await import("../../open-sse/utils/streamContentPeek.js");
const { isSafetyStopPayload } = await import("../../open-sse/utils/safetyStopFrame.js");
const { createEmptyTerminalGuard } = await import("../../open-sse/utils/emptyStreamTerminal.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

const log = { info() {}, warn() {}, error() {}, debug() {} };
const encoder = new TextEncoder();
const frame = (payload, event) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(payload)}\n\n`;
const DONE = "data: [DONE]\n\n";
const sse = (text) => new Response(new ReadableStream({
  start(controller) { controller.enqueue(encoder.encode(text)); controller.close(); },
}), { status: 200, headers: { "content-type": "text/event-stream" } });
const SIBLING = `${frame({ choices: [{ delta: { content: "sibling answer" } }] })}${DONE}`;

// Ordinary structured provider stops, one per wire protocol.
const STOPS = {
  "OpenAI finish_reason content_filter": frame({ choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }] }) + DONE,
  "OpenAI delta.refusal": frame({ choices: [{ index: 0, delta: { refusal: "I can't help with that." } }] }) +
    frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + DONE,
  "Claude stop_reason refusal": frame({ type: "message_start", message: { id: "m", role: "assistant", content: [], usage: { input_tokens: 5, output_tokens: 0 } } }, "message_start") +
    frame({ type: "message_delta", delta: { stop_reason: "refusal", stop_details: { type: "refusal", explanation: "Blocked by policy." } }, usage: { output_tokens: 0 } }, "message_delta") +
    frame({ type: "message_stop" }, "message_stop"),
  "Responses refusal.done": frame({ type: "response.refusal.done", refusal: "I can't help with that." }, "response.refusal.done") +
    frame({ type: "response.completed", response: { status: "completed", output: [] } }, "response.completed") + DONE,
  "Responses incomplete content_filter": frame({ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "content_filter" } } }, "response.incomplete"),
  "Gemini finishReason SAFETY": frame({ candidates: [{ finishReason: "SAFETY" }] }),
  "Antigravity wrapped finishReason PROHIBITED_CONTENT": frame({ response: { candidates: [{ finishReason: "PROHIBITED_CONTENT" }] } }),
  "Gemini promptFeedback blockReason": frame({ promptFeedback: { blockReason: "SAFETY" } }),
};

async function runCombo(first, strategy = "priority") {
  const attempted = [];
  const response = await handleComboChat({
    body: { stream: true, messages: [{ role: "user", content: "hi" }] },
    models: ["p1/first", "p2/second"],
    comboName: "safety-terminal-1073",
    comboStrategy: strategy,
    log,
    handleSingleModel: async (_body, model) => {
      attempted.push(model);
      // The first dispatched member returns the stream under test, whatever
      // order the strategy picked; any later dispatch is the sibling.
      return sse(attempted.length === 1 ? first : SIBLING);
    },
  });
  return { response, attempted, text: await response.text() };
}

beforeEach(() => resetComboScoring("safety-terminal-1073"));

describe("structured safety stop recognition", () => {
  it.each(Object.entries(STOPS))("%s is a safety stop but not content", (_name, wire) => {
    const dataLines = wire.split("\n").filter((line) => line.startsWith("data:") && !line.includes("[DONE]"));
    expect(dataLines.some((line) => isSafetyStopPayload(JSON.parse(line.slice(5))))).toBe(true);
    // Refusal text is the provider's answer, but the content check stays about output.
    if (!_name.includes("delta.refusal")) expect(dataLines.some(frameCarriesContent)).toBe(false);
  });

  it.each([
    ["ordinary stop", { choices: [{ finish_reason: "stop", delta: {} }] }],
    ["empty refusal text", { choices: [{ delta: { refusal: "  " } }] }],
    ["Claude end_turn", { type: "message_delta", delta: { stop_reason: "end_turn" } }],
    ["Responses incomplete for length", { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }],
    ["Gemini STOP", { candidates: [{ finishReason: "STOP" }] }],
    ["Gemini MAX_TOKENS", { candidates: [{ finishReason: "MAX_TOKENS" }] }],
    ["error envelope", { error: { type: "server_error", message: "boom" } }],
    ["non object", null],
  ])("does not treat %s as a safety stop", (_name, payload) => {
    expect(isSafetyStopPayload(payload)).toBe(false);
  });
});

describe("stream peek", () => {
  it.each(Object.entries(STOPS))("%s settles as a replayed safety_stop", async (_name, wire) => {
    const peek = await peekStreamForContent(sse(wire));
    expect(peek.outcome).toBe("safety_stop");
    expect(peek.hasContent).toBe(true);
    expect(await new Response(peek.body).text()).toBe(wire);
  });

  it("keeps empty and error-only streams out of safety_stop", async () => {
    expect((await peekStreamForContent(sse(`: ping\n\n${DONE}`))).outcome).toBe("empty");
    const failed = await peekStreamForContent(sse(frame({ error: { type: "server_error", message: "temporary" } }) + DONE));
    expect(failed.outcome).toBe("empty");
    expect(failed.hasContent).toBe(false);
    expect(failed.streamError.type).toBe("server_error");
  });

  it("still reports ordinary content as content", async () => {
    expect((await peekStreamForContent(sse(SIBLING))).outcome).toBe("content");
  });
});

describe("combo stream handling", () => {
  for (const strategy of ["priority", "smart-scoring", "round-robin"]) {
    it.each(Object.entries(STOPS))(`${strategy}: %s ends the combo without a sibling`, async (_name, wire) => {
      const { response, attempted, text } = await runCombo(wire, strategy);
      expect(attempted).toHaveLength(1);
      expect(response.status).toBe(200);
      expect(text).toBe(wire);
      expect(text).not.toContain("sibling answer");
      expect(getComboModelQuotaHealth("safety-terminal-1073", attempted[0])).toBe("healthy");
    });
  }

  it("keeps the explicit refusal text and diagnostics unchanged on the wire", async () => {
    const { text } = await runCombo(STOPS["Claude stop_reason refusal"]);
    expect(text).toContain("Blocked by policy.");
    expect(text).toContain('"stop_reason":"refusal"');
  });

  it("still falls back after a genuinely empty stream", async () => {
    const { attempted, text } = await runCombo(`: ping\n\n${DONE}`);
    expect(attempted).toHaveLength(2);
    expect(text).toBe(SIBLING);
  });

  it("still falls back after a retryable in-stream error", async () => {
    const { attempted, text } = await runCombo(frame({ error: { type: "server_error", message: "temporary" } }) + DONE);
    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(text).toBe(SIBLING);
  });

  it("keeps the local request-scoped error contract: a later member may still serve", async () => {
    // #2068: typed request errors are not provider safety stops and keep their
    // existing candidate-then-fallback handling.
    const { attempted, text } = await runCombo(frame({ error: { type: "invalid_request_error", message: "Invalid input" } }) + DONE);
    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(text).toBe(SIBLING);
  });

  it("does not hold back a later sibling-free stop after earlier content", async () => {
    const wire = frame({ choices: [{ delta: { content: "partial" } }] }) + STOPS["OpenAI finish_reason content_filter"];
    const { attempted, text } = await runCombo(wire);
    expect(attempted).toEqual(["p1/first"]);
    expect(text).toBe(wire);
  });
});

describe("single-model early-EOF failover", () => {
  it.each(Object.entries(STOPS))("%s does not fail over to another account", async (_name, wire) => {
    const held = await holdForEarlyEof(sse(wire), 1000);
    expect(held.failed).toBe(false);
    expect(await held.response.text()).toBe(wire);
  });

  it("still fails over on an empty stream", async () => {
    expect((await holdForEarlyEof(sse(`: ping\n\n${DONE}`), 1000)).failed).toBe(true);
  });
});

describe("passthrough empty-terminal guard", () => {
  const through = async (format, wire) =>
    new Response(sse(wire).body.pipeThrough(createEmptyTerminalGuard(format, () => true, () => ({})))).text();
  const EMPTY_ERROR = "Provider returned empty content";

  it.each([
    ["OpenAI delta.refusal", FORMATS.OPENAI],
    ["Claude stop_reason refusal", FORMATS.CLAUDE],
    ["Responses refusal.done", FORMATS.OPENAI_RESPONSES],
    ["OpenAI finish_reason content_filter", FORMATS.OPENAI],
    ["Responses incomplete content_filter", FORMATS.OPENAI_RESPONSES],
  ])("%s is forwarded as the provider's answer, not an empty-content error", async (name, format) => {
    const out = await through(format, STOPS[name]);
    expect(out).toBe(STOPS[name]);
    expect(out).not.toContain(EMPTY_ERROR);
  });

  it("still replaces a genuinely empty success terminal with the empty-content error", async () => {
    const out = await through(FORMATS.OPENAI, frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + DONE);
    expect(out).toContain(EMPTY_ERROR);
  });
});
