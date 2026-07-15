import { describe, it, expect } from "vitest";

import { applyParamRenames, stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("stripUnsupportedParams", () => {
  it("flattens Cloudflare AI OpenAI text content-part arrays", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello " },
            { type: "text", text: "world" },
          ],
        },
      ],
    };

    expect(() => stripUnsupportedParams("cloudflare-ai", "@cf/meta/llama-3.1-8b-instruct", body)).not.toThrow();
    expect(body.messages[0].content).toBe("hello world");
  });

  it("throws on Cloudflare AI non-text content parts without silently dropping them (#6390)", () => {
    const imagePart = { type: "image_url", image_url: { url: "data:image/png;base64,xx" } };
    const body = {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello " }, imagePart, { type: "text", text: "world" }],
        },
      ],
    };

    expect(() => stripUnsupportedParams("cloudflare-ai", "@cf/meta/llama-3.1-8b-instruct", body)).toThrow(
      /does not accept image\/non-text content parts/
    );
    // Content array left intact: no silent data loss (#6390 safeguard).
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "hello " },
      imagePart,
      { type: "text", text: "world" },
    ]);
  });

  it.each([
    ["Opus", "claude-opus-4-6"],
    ["Sonnet", "claude-sonnet-4-6"],
    ["Haiku", "claude-haiku-4-5-20251001"],
  ])("drops temperature from Claude %s models while preserving unrelated fields", (_family, model) => {
    const body = { temperature: 0.7, top_p: 1 };

    stripUnsupportedParams("anthropic", model, body);

    expect(body).toEqual({ top_p: 1 });
  });

  it("preserves temperature for GPT-4o", () => {
    const body = { temperature: 0.7, top_p: 1 };

    stripUnsupportedParams("openai", "gpt-4o", body);

    expect(body).toEqual({ temperature: 0.7, top_p: 1 });
  });

  it("still drops unsupported GitHub model params", () => {
    const body = { temperature: 0.7, top_p: 1 };

    stripUnsupportedParams("github", "gpt-5.4", body);

    expect(body).toEqual({ top_p: 1 });
  });

  it("clamps VolcEngine Ark GLM max token fields to the model output ceiling", () => {
    const body = {
      max_tokens: 131072,
      max_completion_tokens: 131072,
      max_output_tokens: 131072,
    };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body).toEqual({
      max_tokens: 128000,
      max_completion_tokens: 128000,
      max_output_tokens: 128000,
    });
  });

  it("keeps VolcEngine Ark GLM max tokens when already under the ceiling", () => {
    const body = { max_tokens: 64000 };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body.max_tokens).toBe(64000);
  });
});

describe("applyParamRenames", () => {
  // Acceptance table for the max_tokens <-> max_completion_tokens normalization
  // (OmniRoute #6912/#6964). Direction is chosen by the model string alone,
  // provider-independent; an explicitly set destination field always wins and
  // only one spelling survives.
  const cases = [
    // o1/o3/o4/gpt-5.x families forward-rename on ANY provider route.
    ["openai", "o1", { max_tokens: 100 }, { max_completion_tokens: 100 }],
    ["openai", "o3", { max_tokens: 99999 }, { max_completion_tokens: 99999 }],
    ["openai", "o4-mini", { max_tokens: 200 }, { max_completion_tokens: 200 }],
    ["openai", "gpt-5.4", { max_tokens: 300 }, { max_completion_tokens: 300 }],
    ["openai", "gpt-5.5-pro", { max_tokens: 400 }, { max_completion_tokens: 400 }],
    // Same families reached through a prefixed non-OpenAI provider must still
    // forward-rename (provider independence; mirrors source supportsMaxTokens).
    ["openrouter", "openai/o3", { max_tokens: 500 }, { max_completion_tokens: 500 }],
    ["volcengine-ark", "azure:o1-preview", { max_tokens: 600 }, { max_completion_tokens: 600 }],
    ["github", "gpt-5.4", { max_tokens: 700 }, { max_completion_tokens: 700 }],
    // Both fields present: destination wins, source field is deleted (forward).
    ["openai", "o3", { max_tokens: 500, max_completion_tokens: 30 }, { max_completion_tokens: 30 }],
    // Both fields present: destination wins (reverse) — Volcengine DeepSeek path.
    ["volcengine-ark", "DeepSeek-V4-Flash", { max_tokens: 500, max_completion_tokens: 30 }, { max_tokens: 500 }],
    // Reverse rename for any model that supports the legacy field (#6912 else-branch).
    ["volcengine-ark", "DeepSeek-V4-Flash", { max_completion_tokens: 30 }, { max_tokens: 30 }],
    ["openai", "gpt-4o", { max_completion_tokens: 45 }, { max_tokens: 45 }],
    // Unrelated control: nonmatching model with only max_tokens is untouched,
    // and substring lookalikes ("v3o1") are not family matches.
    ["volcengine-ark", "DeepSeek-V4-Flash", { max_tokens: 64000 }, { max_tokens: 64000 }],
    ["openai", "deepseek-v3o1-chat", { max_tokens: 800 }, { max_tokens: 800 }],
    ["openai", "gpt-4o", { temperature: 0.7 }, { temperature: 0.7 }],
  ];

  for (const [provider, model, input, expected] of cases) {
    it(`${provider}/${model} ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      const body = { ...input };

      applyParamRenames(provider, model, body);

      expect(body).toEqual(expected);
    });
  }
});
