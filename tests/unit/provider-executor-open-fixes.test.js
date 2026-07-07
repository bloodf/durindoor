import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

const credentials = { apiKey: "k" };

function bodyWithClientMetadata() {
  return {
    model: "z-ai/glm-5.2",
    messages: [{ role: "user", content: "hi" }],
    client_metadata: { client: "codex" },
  };
}

describe("open provider executor fixes", () => {
  it("DefaultExecutor strips client_metadata for NVIDIA", () => {
    const out = new DefaultExecutor("nvidia").transformRequest(
      "z-ai/glm-5.2",
      bodyWithClientMetadata(),
      false,
      credentials,
    );
    expect(out.client_metadata).toBeUndefined();
  });

  it("NVIDIA z-ai/glm-5.2 strips both reasoning and thinking request fields", () => {
    const body = {
      model: "z-ai/glm-5.2",
      reasoning: { effort: "high" },
      thinking: { type: "adaptive" },
      max_tokens: 512,
    };

    stripUnsupportedParams("nvidia", "z-ai/glm-5.2", body);

    expect(body.reasoning).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(512);
  });
});
