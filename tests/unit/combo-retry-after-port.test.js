import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });
const chatMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  getModelInfo: vi.fn(async () => ({ provider: "status-test", model: "model" })),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true })),
  handleChatCore: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: chatMocks.getSettings, getApiKeyByKey: vi.fn(), getApiKeyUsageLimitStatus: vi.fn(),
  getProviderConnections: vi.fn(async () => []), getQuotaReservationPressure: vi.fn(async () => new Map()),
}));
vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()), getModelInfo: chatMocks.getModelInfo, getComboModels: vi.fn(async () => null), loadCustomCapabilities: vi.fn(async () => null),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: chatMocks.getProviderCredentials,
  projectProviderCredentials: vi.fn(), markAccountUnavailable: chatMocks.markAccountUnavailable,
  clearAccountError: vi.fn(), resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true } })),
  isProviderConnectionModelLocked: vi.fn(() => false), providerAllowsPublicNoAuthFallback: vi.fn(() => false),
}));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({ handleChatCore: chatMocks.handleChatCore }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: vi.fn() }));
vi.mock("../../open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: vi.fn(async () => null) }));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: chatMocks.execute }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(),
}));

const log = { info() {}, warn() {} };
const now = Date.parse("2026-11-12T00:00:00Z");
const reset = seconds => new Date(now + seconds * 1000).toISOString();
const failure = (header, body = {}) => new Response(JSON.stringify({ error: { message: "rate limit" }, ...body }), {
  status: 429, headers: header === undefined ? {} : { "retry-after": header },
});
let sequence = 0;
async function run(responses) {
  const id = sequence++;
  return handleComboChat({ body: { stream: false }, models: responses.map((_, i) => `openai/model${id}-${i}`),
    comboName: `retry-port-${id}`, comboStrategy: "fallback", log, handleSingleModel: async () => responses.shift() });
}

async function chatWithCooldown(cooldown) {
  chatMocks.getProviderCredentials.mockResolvedValue({ allRateLimited: true, lastError: "Unavailable", ...cooldown });
  const { handleChat } = await import("../../src/sse/handlers/chat.js");
  return handleChat(new Request("http://localhost/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/test", stream: false, messages: [{ role: "user", content: "hi" }] }),
  }));
}

describe("cooldown retry timing", () => {
  it("selects the earliest valid header and legacy reset", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const response = await run([failure("120"), failure(new Date(now + 20000).toUTCString()), failure(undefined, { retryAfter: reset(45) })]);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("20");
    } finally { vi.restoreAllMocks(); }
  });
  it.each(["-3600", "+3", "3.5", "invalid", "November 2099", "999999999999999999999999", new Date(now - 1000).toUTCString()])("ignores unusable header %s and retains valid legacy timing", async value => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    try { expect((await run([failure(value, { retryAfter: reset(25) })])).headers.get("retry-after")).toBe("25"); }
    finally { vi.restoreAllMocks(); }
  });
  it("ignores unusable timing without inventing a retry header", async () => {
    const response = await run([failure("999999999999999999999999", { retryAfter: "-3600" })]);
    expect(response.status).toBe(429);
    expect(response.headers.has("retry-after")).toBe(false);
  });
  it("does not impose a wait when the header allows an immediate retry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const response = await run([failure("0", { retryAfter: reset(25) })]);
      expect(response.status).toBe(429);
      expect(response.headers.has("retry-after")).toBe(false);
    } finally { vi.restoreAllMocks(); }
  });
  it("retains the reset timestamp from an existing rate-limit envelope", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const response = await run([failure(undefined, { error: { message: "rate limit", retry_after: reset(25) } })]);
      expect(response.headers.get("retry-after")).toBe("25");
    } finally { vi.restoreAllMocks(); }
  });
  it("ignores a billing exhaustion retry header", async () => {
    const billing = Response.json({ error: { message: "credit balance is too low" } }, {
      status: 400, headers: { "retry-after": "60" },
    });
    const response = await run([billing]);
    expect(response.headers.has("retry-after")).toBe(false);
  });
  it("keeps the combo's authentication status without attaching another member's reset", async () => {
    const authFailure = Response.json({ error: { message: "Authentication failed" } }, { status: 401 });
    const response = await run([authFailure, failure("60")]);
    expect(response.status).toBe(401);
    expect(response.headers.has("retry-after")).toBe(false);
  });
  it("returns a successful fallback without retry guidance", async () => {
    const success = Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] });
    expect(await run([failure("10"), success])).toBe(success);
  });
  it.each([
    [429, 429], ["429", 429], [401, 401], [403, 403], [502, 502],
    ["invalid", 503], [600, 503], [429.5, 503], [[429], 503],
  ])("validates cached chat status %j", async (status, expectedStatus) => {
    const response = await chatWithCooldown({ lastErrorCode: status });
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.has("retry-after")).toBe(false);
  });
  it("returns the selected model cooldown deadline with its cached 429", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const response = await chatWithCooldown({ lastErrorCode: 429, retryAfter: reset(60) });
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
    } finally { vi.restoreAllMocks(); }
  });
});
