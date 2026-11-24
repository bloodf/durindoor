import { beforeEach, expect, it, vi } from "vitest";
import { applyErrorState, checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";
import { runWithModelFallback } from "../../open-sse/services/modelFallback.js";
import { markAccountUnavailable } from "@/sse/services/auth/accountErrors.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  updateConnection: vi.fn(),
}));

vi.mock("../../open-sse/services/accountFallback.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, checkFallbackError: vi.fn(actual.checkFallbackError) };
});
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: mocks.execute }),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [{ id: "echo-test", isActive: true }]),
  getSettings: vi.fn(async () => ({})),
  updateProviderConnection: mocks.updateConnection,
}));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const provider = "openrouter";
// The suffix hits an existing terminal billing rule if the echo reaches it.
const model = "mymodel/insufficient-credit-余额不足";
const modelSpec = `${provider}/${model}`;
const errorBody = { error: { message: `Rejected request for model ${model}` } };
const errorText = JSON.stringify(errorBody);
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const body = { model, stream: false, messages: [{ role: "user", content: "hi" }] };

beforeEach(() => {
  vi.clearAllMocks();
  resetComboRotation();
});

it("keeps request-scoped account errors from writing a lock, even with a reset hint", async () => {
  const result = await markAccountUnavailable(
    "echo-test", 400, errorText, provider, model, Date.now() + 60_000, { errorBody },
  );

  expect(result).toMatchObject({ shouldFallback: false, cooldownMs: 0 });
  expect(mocks.updateConnection).not.toHaveBeenCalled();
});

it("applies an echoed error without an account cooldown", () => {
  const account = applyErrorState({}, 400, errorText, provider, null, errorBody, model);
  expect(account.rateLimitedUntil).toBeNull();
});

it.each([400, 200])("classifies a combo member's echoed model on HTTP %s", async (status) => {
  const failure = Response.json(errorBody, { status });
  const success = Response.json({ choices: [{ message: { content: "served" } }] });
  const response = await handleComboChat({
    body,
    models: [modelSpec, "openai/backup"],
    handleSingleModel: async (_body, attempt) => attempt === modelSpec ? failure : success,
    log,
    comboName: "echo-test",
    comboStrategy: "fallback",
  });

  expect(response).toBe(success);
  expect(checkFallbackError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status, provider, model }));
  const decision = checkFallbackError.mock.results[0].value;
  expect(decision.terminal).toBeUndefined();
  if (status === 400) {
    expect(decision).toMatchObject({ requestScoped: true, cooldownMs: 0 });
  }
});

it.each([true, false])("classifies the actual rejected model when it is primary=%s", async (isPrimary) => {
  const primary = isPrimary ? modelSpec : "openai/primary";
  const fallbacks = isPrimary ? ["openai/backup"] : [modelSpec, "openai/backup"];
  const failure = Response.json(errorBody, { status: 400 });
  const runner = vi.fn(async (attempt) => attempt === modelSpec ? failure : new Response(null, { status: 503 }));

  expect(await runWithModelFallback(primary, { [primary]: { fallbacks } }, runner, log)).toBe(failure);
  expect(runner.mock.calls.flat()).toEqual(isPrimary ? [modelSpec] : [primary, modelSpec]);
  expect(checkFallbackError).toHaveBeenLastCalledWith(expect.objectContaining({ status: 400, provider, model }));
  expect(checkFallbackError.mock.results.at(-1).value).toMatchObject({ requestScoped: true, cooldownMs: 0 });
});

it("passes the attempted model when chat computes retry timing for a 429", async () => {
  mocks.execute.mockResolvedValueOnce({
    response: Response.json(errorBody, { status: 429 }),
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: {},
    transformedBody: body,
  });

  const result = await handleChatCore({
    body,
    modelInfo: { provider, model },
    credentials: { apiKey: "synthetic-key", providerSpecificData: {} },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "application/json" } },
    log,
  });

  expect(result).toMatchObject({ success: false, status: 429 });
  expect(result.resetsAtMs).toBeGreaterThan(Date.now());
  expect(checkFallbackError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 429, provider, model }));
});
