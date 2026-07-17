// tests/unit/kiro-translator-debug-route.test.js
// Two layers of coverage for the Kiro GPT-5.6 translation-model seam (#2596):
//  1. resolveKiroTranslationModel unit contract — the helper chatCore uses to
//     pick the id handed to translateRequest on the Kiro seam.
//  2. Translator Debug route (Codex RUuLt) — POST-level: step 2 (→ OPENAI) must
//     use the bare upstream id, step 3 (→ target) the canonical suffixed id,
//     while the executor always receives the bare wire id.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { resolveKiroTranslationModel } from "../../open-sse/handlers/chatCore.js";

const mocks = vi.hoisted(() => ({
  translateRequest: vi.fn((_source, _target, _model, body) => body),
  buildUrl: vi.fn(() => "https://kiro.test/v1/chat/completions"),
  buildHeaders: vi.fn(() => ({ Authorization: "Bearer test" })),
  transformRequest: vi.fn((_model, body) => body),
}));

vi.mock("../../open-sse/translator/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, translateRequest: mocks.translateRequest };
});

vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: vi.fn(async () => [{
    isActive: true,
    apiKey: "test-key",
    providerSpecificData: {},
  }]),
}));

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async () => ({ provider: "kiro", model: "gpt-5.6-sol-thinking" })),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    buildUrl: mocks.buildUrl,
    buildHeaders: mocks.buildHeaders,
    transformRequest: mocks.transformRequest,
  }),
}));

const { POST } = await import("../../src/app/api/translator/translate/route.js");

describe("resolveKiroTranslationModel — canonical id handed to the Kiro translator (#2596)", () => {
  it("keeps the canonical suffixed catalog id for Kiro targets", () => {
    expect(
      resolveKiroTranslationModel(FORMATS.KIRO, "kr", "gpt-5.6-sol-thinking", "gpt-5.6-sol"),
    ).toBe("gpt-5.6-sol-thinking");
  });

  it("falls back to the bare upstream id when the alias cannot resolve the variant", () => {
    expect(
      resolveKiroTranslationModel(FORMATS.KIRO, "unknown-provider", "gpt-5.6-sol-thinking", "gpt-5.6-sol"),
    ).toBe("gpt-5.6-sol");
  });

  it("leaves non-Kiro targets on the bare upstream id", () => {
    expect(
      resolveKiroTranslationModel(FORMATS.OPENAI, "openai", "gpt-5.6-sol", "gpt-5.6-sol"),
    ).toBe("gpt-5.6-sol");
  });
});

describe("translator console Kiro GPT-5.6 synthetic suffix preservation (Codex RUuLt)", () => {
  beforeEach(() => {
    mocks.translateRequest.mockClear();
    mocks.buildUrl.mockClear();
    mocks.buildHeaders.mockClear();
    mocks.transformRequest.mockClear();
  });
  it("step 3 hands the canonical suffixed id to translateRequest and the bare id to the executor", async () => {
    const response = await POST({
      json: async () => ({
        step: 3,
        body: {
          provider: "kiro",
          model: "gpt-5.6-sol-thinking-agentic",
          body: {
            model: "gpt-5.6-sol-thinking-agentic",
            messages: [{ role: "user", content: "hello" }],
            stream: false,
          },
        },
      }),
    });

    expect(response.status).toBe(200);

    // translateRequest(OPENAI, KIRO, <canonical suffixed id>, body, ...) — the
    // route passes extra trailing args, so compare the leading triple.
    expect(mocks.translateRequest.mock.calls[0].slice(0, 3)).toEqual([
      FORMATS.OPENAI,
      FORMATS.KIRO,
      "gpt-5.6-sol-thinking-agentic",
    ]);

    // Executor saw only the bare upstream wire id (no synthetic suffix).
    expect(mocks.transformRequest.mock.calls[0][0]).toBe("gpt-5.6-sol");
  });

  it("step 2 (source → OPENAI) uses the bare upstream id, never the Kiro-canonical id", async () => {
    const response = await POST({
      json: async () => ({
        step: 2,
        body: {
          model: "gpt-5.6-sol-thinking",
          messages: [{ role: "user", content: "hello" }],
        },
      }),
    });

    expect(response.status).toBe(200);

    // translateRequest(OPENAI, OPENAI, <bare upstream id>, body, ...) — the
    // target of this step is OpenAI (source format detected as openai here),
    // so the Kiro synthetic id must NOT leak into this step's translation call.
    expect(mocks.translateRequest.mock.calls[0].slice(0, 3)).toEqual([
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-5.6-sol",
    ]);
  });
});
