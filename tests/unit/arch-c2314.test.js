import { describe, expect, it } from "vitest";
import * as gemini from "../../open-sse/services/usage/geminiApiKeyQuotaAdapter.js";
import * as xai from "../../open-sse/services/usage/xaiQuotaAdapter.js";
import * as oldGemini from "../../src/lib/usage/geminiApiKeyQuotaAdapter.js";
import * as oldXai from "../../src/lib/usage/xaiQuotaAdapter.js";

describe("quota adapter locations", () => {
  it("preserves the existing exports through the original paths", () => {
    expect(oldGemini.fetchGeminiApiKeyQuota).toBe(gemini.fetchGeminiApiKeyQuota);
    expect(oldXai.fetchXaiQuota).toBe(xai.fetchXaiQuota);
    expect(oldXai.fetchXaiOAuthQuota).toBe(xai.fetchXaiOAuthQuota);
    expect(oldXai.fetchXaiOAuthAccount).toBe(xai.fetchXaiOAuthAccount);
    expect(oldXai.normalizeXaiPrepaidBalance).toBe(xai.normalizeXaiPrepaidBalance);
  });
});
