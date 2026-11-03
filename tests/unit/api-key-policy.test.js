import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock module dependencies before importing the policy module.
const {
  getApiKeyByKeyMock,
  getApiKeyUsageTotalsMock,
  saveRequestUsageMock,
  extractApiKeyMock,
  hasValidCliTokenMock,
  errorResponseMock,
} = vi.hoisted(() => ({
  getApiKeyByKeyMock: vi.fn(),
  getApiKeyUsageTotalsMock: vi.fn(),
  saveRequestUsageMock: vi.fn(),
  extractApiKeyMock: vi.fn(),
  hasValidCliTokenMock: vi.fn(),
  errorResponseMock: vi.fn((status, message) => ({ status, message })),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: getApiKeyByKeyMock,
  getApiKeyUsageTotals: getApiKeyUsageTotalsMock,
  getApiKeyById: vi.fn(),
  saveRequestUsage: saveRequestUsageMock,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: extractApiKeyMock,
  hasValidCliToken: hasValidCliTokenMock,
}));

vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: errorResponseMock,
}));

vi.mock("open-sse/config/runtimeConfig.js", () => ({
  HTTP_STATUS: {
    FORBIDDEN: 403,
    RATE_LIMITED: 429,
  },
}));

vi.mock("../../src/sse/services/apiKeyPolicyIdentity.js", () => ({
  canonicalizePolicyModelIdentity: (value) => value,
}));

const load = () => import("../../src/sse/services/apiKeyPolicy.js");

function makeRequest(headers = {}, url = "http://localhost/v1/chat/completions") {
  return {
    url,
    headers: {
      get: (name) => headers[name] ?? null,
    },
  };
}

function makeQuery(url, key) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}key=${key}`;
}

const VALID_CLI_TOKEN = "valid-cli-token";

describe("api-key-policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveRequestUsageMock.mockReset().mockResolvedValue(true);
    hasValidCliTokenMock.mockImplementation(
      async (request) => request?.headers?.get?.("x-9r-cli-token") === VALID_CLI_TOKEN
    );
  });

  it("denies a model not in the allowedModels allowlist", async () => {
    const apiKey = "key-allowlist";
    const model = "forbidden-model";
    extractApiKeyMock.mockReturnValue(apiKey);
    getApiKeyByKeyMock.mockResolvedValue({
      id: "k1",
      name: "Allowlist Key",
      isActive: true,
      policy: { allowedModels: ["allowed-model"] },
    });

    const { enforceApiKeyModelPolicy } = await load();
    const result = await enforceApiKeyModelPolicy(makeRequest(), model);

    expect(result).toEqual(errorResponseMock(403, `Model "${model}" is not allowed for this API key`));
  });

  it("denies when token usage reaches or exceeds maxTokens", async () => {
    const apiKey = "key-tokens";
    const model = "gpt-4";
    extractApiKeyMock.mockReturnValue(apiKey);
    getApiKeyByKeyMock.mockResolvedValue({
      id: "k2",
      name: "Token Capped Key",
      isActive: true,
      policy: { maxTokens: 1000 },
    });
    getApiKeyUsageTotalsMock.mockResolvedValue({ totalTokens: 1000, totalCost: 0 });

    const { enforceApiKeyModelPolicy } = await load();
    const result = await enforceApiKeyModelPolicy(makeRequest(), model);

    expect(result).toEqual(errorResponseMock(429, "API key token limit reached (1000/1000 tokens)"));
  });

  it("denies when cost usage reaches or exceeds maxCostUsd", async () => {
    const apiKey = "key-cost";
    const model = "gpt-4";
    extractApiKeyMock.mockReturnValue(apiKey);
    getApiKeyByKeyMock.mockResolvedValue({
      id: "k3",
      name: "Cost Capped Key",
      isActive: true,
      policy: { maxCostUsd: 5 },
    });
    getApiKeyUsageTotalsMock.mockResolvedValue({ totalTokens: 0, totalCost: 5.5 });

    const { enforceApiKeyModelPolicy } = await load();
    const result = await enforceApiKeyModelPolicy(makeRequest(), model);

    expect(result).toEqual(errorResponseMock(429, "API key cost limit reached ($5.5000/$5)"));
  });

  it("fails closed when a persisted policy is malformed", async () => {
    extractApiKeyMock.mockReturnValue("key-malformed");
    getApiKeyByKeyMock.mockResolvedValue({
      id: "k-malformed",
      name: "Malformed Key",
      isActive: true,
      policy: { allowedModels: "allowed-model", maxTokens: "NaN" },
    });

    const { enforceApiKeyModelPolicy } = await load();
    const result = await enforceApiKeyModelPolicy(makeRequest(), "allowed-model");

    expect(result).toEqual(errorResponseMock(403, "API key policy is invalid; contact the administrator"));
    expect(getApiKeyUsageTotalsMock).not.toHaveBeenCalled();
  });

  it("bypasses policy enforcement with a valid x-9r-cli-token", async () => {
    const { enforceApiKeyModelPolicy } = await load();
    const result = await enforceApiKeyModelPolicy(
      makeRequest({ "x-9r-cli-token": VALID_CLI_TOKEN }),
      "any-model"
    );

    expect(hasValidCliTokenMock).toHaveBeenCalledWith(expect.anything());
    expect(extractApiKeyMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("enforces policy when an arbitrary non-empty x-9r-cli-token is supplied", async () => {
    const apiKey = "key-arbitrary-cli";
    const model = "allowed-model";
    extractApiKeyMock.mockReturnValue(apiKey);
    getApiKeyByKeyMock.mockResolvedValue({
      id: "k4",
      name: "Regular Key",
      isActive: true,
      policy: { allowedModels: ["allowed-model"] },
    });

    const { enforceApiKeyModelPolicy } = await load();
    const result = await enforceApiKeyModelPolicy(
      makeRequest({ "x-9r-cli-token": "not-the-cli-token" }),
      model
    );

    expect(hasValidCliTokenMock).toHaveBeenCalledWith(expect.anything());
    expect(extractApiKeyMock).toHaveBeenCalledWith(expect.anything());
    expect(result).toBeNull();
  });

  it("allows a Gemini-style x-goog-api-key header to pass policy checks", async () => {
    const apiKey = "key-gemini-header";
    const model = "allowed-model";
    extractApiKeyMock.mockReturnValue(apiKey);
    getApiKeyByKeyMock.mockResolvedValue({
      id: "k6",
      name: "Gemini Header Key",
      isActive: true,
      policy: { allowedModels: ["allowed-model"] },
    });

    const { enforceApiKeyModelPolicy } = await load();
    const result = await enforceApiKeyModelPolicy(
      makeRequest({ "x-goog-api-key": apiKey }),
      model
    );

    expect(extractApiKeyMock).toHaveBeenCalledWith(expect.anything());
    expect(result).toBeNull();
  });

  it("allows a Gemini-style ?key= query parameter to pass policy checks", async () => {
    const apiKey = "key-gemini-query";
    const model = "allowed-model";
    extractApiKeyMock.mockReturnValue(apiKey);
    getApiKeyByKeyMock.mockResolvedValue({
      id: "k7",
      name: "Gemini Query Key",
      isActive: true,
      policy: { allowedModels: ["allowed-model"] },
    });

    const { enforceApiKeyModelPolicy } = await load();
    const result = await enforceApiKeyModelPolicy(
      makeRequest({}, makeQuery("http://localhost/v1/chat/completions", apiKey)),
      model
    );

    expect(extractApiKeyMock).toHaveBeenCalledWith(expect.anything());
    expect(result).toBeNull();
  });

  it("keeps web search and fetch identities least-privilege with bare-provider compatibility", async () => {
    const { isModelAllowed } = await load();
    expect(isModelAllowed({ allowedModels: ["tinyfish/fetch"] }, "tinyfish/fetch")).toBe(true);
    expect(isModelAllowed({ allowedModels: ["tinyfish/fetch"] }, "tinyfish/search")).toBe(false);
    expect(isModelAllowed({ allowedModels: ["tinyfish"] }, "tinyfish/fetch")).toBe(true);
    expect(isModelAllowed({ allowedModels: ["tinyfish"] }, "tinyfish/search")).toBe(true);
  });

  it("rejects totals-only events before any ledger write", async () => {
    const { recordApiKeyUsage } = await load();
    await expect(recordApiKeyUsage("key", { tokens: 42, cost: 0.01 })).rejects.toMatchObject({
      code: "USAGE_ACCOUNTING_FAILED",
      cause: expect.any(TypeError),
    });
    expect(saveRequestUsageMock).not.toHaveBeenCalled();
  });

  const usage = {
    usageEventId: "policy-event",
    provider: "openai",
    model: "tts-1",
    endpoint: "/v1/audio/speech",
    connectionId: "connection-1",
    modality: "tts",
    tokens: {},
    nativeUnits: { characters: 9 },
    cost: null,
    costStatus: "unknown",
    costSource: "unavailable",
  };

  it.each([400, 401, 403, 429, 500])("does not account for a %s response", async (status) => {
    const { recordApiKeyUsageForResponse } = await load();
    const response = new Response("failed", { status });
    expect(await recordApiKeyUsageForResponse("key", response, usage)).toBe(response);
    expect(saveRequestUsageMock).not.toHaveBeenCalled();
  });

  it("propagates storage failure after a successful upstream response", async () => {
    const cause = new Error("storage unavailable");
    saveRequestUsageMock.mockRejectedValue(cause);
    const { recordApiKeyUsageForResponse } = await load();
    await expect(recordApiKeyUsageForResponse("key", new Response("ok"), usage)).rejects.toMatchObject({
      code: "USAGE_ACCOUNTING_FAILED",
      cause,
    });
  });

  it("rejects an uncommitted ledger result instead of reporting success", async () => {
    saveRequestUsageMock.mockResolvedValue(false);
    const { recordApiKeyUsage } = await load();
    await expect(recordApiKeyUsage("key", usage)).rejects.toMatchObject({
      code: "USAGE_ACCOUNTING_FAILED",
      message: "Usage accounting was not committed",
    });
  });
});
