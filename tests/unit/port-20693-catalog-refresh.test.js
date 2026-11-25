import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { resolveModelLimits } from "../../open-sse/providers/capabilities.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const ids = (provider) => PROVIDER_MODELS[provider].map((model) => model.id);

describe("catalog refresh (OmniRoute #20693)", () => {
  it.each(["mimo-v2.6-pro", "mimo-v2.6-flash", "mimo-v2.6-pro-ultraspeed"])(
    "advertises 1,048,576 context and 131,072 output for %s",
    (model) => {
      expect(resolveModelLimits("xiaomi-mimo", model)).toMatchObject({ contextWindow: 1048576, maxOutput: 131072 });
    },
  );

  it("advertises the GLM 4.5V limits", () => {
    expect(resolveModelLimits("glmt", "glm-4.5v")).toMatchObject({ contextWindow: 64000, maxOutput: 16384 });
  });

  it.each([[undefined, 16384], [32768, 16384], [2048, 2048]])(
    "sends GLM 4.5V max_tokens %s as %s",
    (requested, sent) => {
      const body = { messages: [{ role: "user", content: "describe" }], ...(requested ? { max_tokens: requested } : null) };
      const wire = new DefaultExecutor("glmt").transformRequest("glm-4.5v", body, false, { apiKey: "synthetic" });
      expect(wire.max_tokens).toBe(sent);
    },
  );

  it("lists the new GPT Image and SenseNova ids", () => {
    expect(ids("openai")).toEqual(expect.arrayContaining(["gpt-image-2.6-sunburst", "gpt-image-2.6-flare"]));
    expect(ids("sensenova")).toContain("sensenova-6.8-flash-lite");
  });
});
