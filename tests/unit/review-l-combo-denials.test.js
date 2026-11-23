import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  comboPolicyRejection,
  getSmartScoredModels,
  handleComboChat,
  resetComboScoring,
} from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, debug() {}, error() {} };
const ok = () => Response.json({ ok: true });

const media = vi.hoisted(() => ({ key: null }));
vi.mock("@/lib/localDb", async (importOriginal) => ({
  ...(await importOriginal()),
  getSettings: vi.fn(async () => ({ requireApiKey: true })),
  getApiKeyByKey: vi.fn(async () => media.key),
  getComboForModel: vi.fn(async () => null),
}));
vi.mock("@/sse/services/auth.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "test-key", auth: { ok: true, apiKeyId: "key-id", billingEpoch: null } })),
}));
vi.mock("../../src/sse/services/auth.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "test-key", auth: { ok: true, apiKeyId: "key-id", billingEpoch: null } })),
}));
const imageHandler = (await import("../../src/sse/handlers/imageGeneration.js")).handleImageGeneration;
const ttsHandler = (await import("../../src/sse/handlers/tts.js")).handleTts;

describe("per-key policy denials in combos", () => {
  beforeEach(() => resetComboScoring());

  it("falls through a policy-denied member without lowering its shared score", async () => {
    const comboName = `policy-denial-${Date.now()}`;
    const models = ["provider/denied", "provider/allowed"];
    const tried = [];

    const response = await handleComboChat({
      body: {}, models, comboName, comboStrategy: "smart-scoring", log,
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        return model === models[0] ? comboPolicyRejection() : ok();
      },
    });

    expect(response.status).toBe(200);
    expect(tried).toEqual(models);
    expect(getSmartScoredModels(models, comboName)).toEqual(models);
  });

  it.each([
    ["image generation", imageHandler, "/v1/images/generations", { model: "auto/gemma", prompt: "a tree" }],
    ["TTS", ttsHandler, "/v1/audio/speech", { model: "auto/gemma", input: "hello" }],
  ])("enforces allowAutoCombos for %s", async (_name, handler, path, body) => {
    media.key = { policy: { allowAutoCombos: false } };
    const response = await handler(new Request(`http://localhost${path}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-key" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("auto combos are not allowed");
  });
});
