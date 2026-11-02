import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { recordApiKeyUsageForResponse } from "../../src/sse/services/apiKeyPolicy.js";

const { saveRequestUsage } = vi.hoisted(() => ({ saveRequestUsage: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  saveRequestUsage,
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  getApiKeyById: vi.fn(),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: vi.fn(),
  hasValidCliToken: vi.fn(),
}));

const log = { info() {}, warn() {}, debug() {}, error() {} };
const models = ["openai/tts-1", "openai/tts-1-hd"];
const usage = {
  usageEventId: "media-combo-accounting-failure",
  provider: "openai",
  model: "tts-1",
  connectionId: "account-a",
  endpoint: "/v1/audio/speech",
  modality: "tts",
  tokens: {},
  nativeUnits: { characters: 5 },
  cost: 0.01,
  costStatus: "known",
  costSource: "provider",
};
const runCombo = (handleSingleModel, signal) => handleComboChat({
  body: { input: "hello" }, models, handleSingleModel, log, signal,
  comboStrategy: "priority", autoSwitch: false, checkEmptyBody: false,
});

beforeEach(() => {
  saveRequestUsage.mockReset();
  saveRequestUsage.mockResolvedValue(true);
});

describe("media combo accounting failures", () => {
  it.each(["throw", "false", "invalid", "abort"])("does not redispatch completed upstream work after %s accounting failure", async (failure) => {
    const cause = new Error("ledger unavailable");
    const controller = new AbortController();
    if (failure === "throw" || failure === "abort") {
      saveRequestUsage.mockImplementation(async () => {
        if (failure === "abort") controller.abort();
        throw cause;
      });
    } else if (failure === "false") {
      saveRequestUsage.mockResolvedValue(false);
    }
    const provider = vi.fn(async () => new Response("paid audio", { status: 200 }));
    let accountingError;
    const dispatch = vi.fn(async () => {
      const response = await provider();
      try {
        return await recordApiKeyUsageForResponse("client-key", response, failure === "invalid" ? {} : usage);
      } catch (error) {
        accountingError = error;
        throw error;
      }
    });
    const result = runCombo(dispatch, controller.signal);
    await expect(result).rejects.toMatchObject({ code: "USAGE_ACCOUNTING_FAILED" });
    await expect(result).rejects.toBe(accountingError);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    if (failure === "throw" || failure === "abort") expect(accountingError.cause).toBe(cause);
    if (failure === "false") expect(accountingError.cause.message).toBe("Usage accounting was not committed");
    if (failure === "invalid") {
      expect(accountingError.cause).toBeInstanceOf(TypeError);
      expect(saveRequestUsage).not.toHaveBeenCalled();
    }
  });

  it("preserves fallback on a genuine upstream exception", async () => {
    const response = new Response("fallback audio", { status: 200 });
    const provider = vi.fn()
      .mockRejectedValueOnce(new Error("provider connection reset"))
      .mockResolvedValueOnce(response);
    const dispatch = vi.fn(async (_body, model) => recordApiKeyUsageForResponse(
      "client-key", await provider(model), { ...usage, model: model.split("/")[1] },
    ));
    expect(await runCombo(dispatch)).toBe(response);
    expect(provider.mock.calls).toEqual(models.map((model) => [model]));
    expect(saveRequestUsage).toHaveBeenCalledTimes(1);
  });
});
