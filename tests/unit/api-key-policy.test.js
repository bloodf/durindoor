import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock module dependencies before importing the policy module.
const {
  getApiKeyByKeyMock,
  getApiKeyUsageTotalsMock,
  incrementApiKeyUsageSyncMock,
  extractApiKeyMock,
  getConsistentMachineIdMock,
  errorResponseMock,
} = vi.hoisted(() => ({
  getApiKeyByKeyMock: vi.fn(),
  getApiKeyUsageTotalsMock: vi.fn(),
  incrementApiKeyUsageSyncMock: vi.fn(),
  extractApiKeyMock: vi.fn(),
  getConsistentMachineIdMock: vi.fn(),
  errorResponseMock: vi.fn((status, message) => ({ status, message })),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: getApiKeyByKeyMock,
  getApiKeyUsageTotals: getApiKeyUsageTotalsMock,
  getApiKeyById: vi.fn(),
  incrementApiKeyUsageSync: incrementApiKeyUsageSyncMock,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: extractApiKeyMock,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: getConsistentMachineIdMock,
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

const CLI_SALT = "9r-cli-auth";
const VALID_CLI_TOKEN = "valid-cli-token";

describe("api-key-policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConsistentMachineIdMock.mockResolvedValue(VALID_CLI_TOKEN);
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

  it("bypasses policy enforcement with a valid x-9r-cli-token", async () => {
    const { enforceApiKeyModelPolicy } = await load();
    const result = await enforceApiKeyModelPolicy(
      makeRequest({ "x-9r-cli-token": VALID_CLI_TOKEN }),
      "any-model"
    );

    expect(getConsistentMachineIdMock).toHaveBeenCalledWith(CLI_SALT);
    expect(extractApiKeyMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("enforces policy when an arbitrary non-empty x-9r-cli-token is supplied", async () => {
    const apiKey = "key-arbitrary-cli";
    const model = "allowed-model";
    getConsistentMachineIdMock.mockResolvedValue("valid-cli-token");
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

    expect(getConsistentMachineIdMock).toHaveBeenCalledWith(CLI_SALT);
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

  it("records non-chat usage by looking up the key and incrementing its usage totals", async () => {
    const { getAdapter } = vi.hoisted(() => ({ getAdapter: vi.fn() }));
    vi.doMock("@/lib/db/driver.js", () => ({ getAdapter }));
    const db = { get: vi.fn() };
    getAdapter.mockResolvedValue(db);
    db.get.mockReturnValue({ id: "k5" });

    const { recordApiKeyUsage } = await load();
    await recordApiKeyUsage(apiKey, { tokens: 42, cost: 0.01 });

    expect(db.get).toHaveBeenCalledWith("SELECT id FROM apiKeys WHERE key = ?", [apiKey]);
    expect(incrementApiKeyUsageSyncMock).toHaveBeenCalledWith(db, "k5", { tokens: 42, cost: 0.01 });
  });
});
