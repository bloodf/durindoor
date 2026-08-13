import { describe, expect, it } from "vitest";

import { detectUpstreamError, handleComboChat } from "../../open-sse/services/combo.js";

const log = {
  info() {},
  warn() {},
};

describe("combo HTTP 200 error fallback", () => {
  it("falls through when a provider embeds an error in a successful JSON response", async () => {
    const attempts = [];
    const response = await handleComboChat({
      body: { stream: true },
      models: ["openai/first", "openai/second"],
      comboName: "fallback-test",
      comboStrategy: "fallback",
      log,
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        if (model === "openai/first") {
          return Response.json({ error: { message: "upstream unavailable" } });
        }
        return Response.json({ choices: [{ message: { content: "fallback worked" } }] });
      },
    });

    expect(attempts).toEqual(["openai/first", "openai/second"]);
    expect(await response.json()).toEqual({
      choices: [{ message: { content: "fallback worked" } }],
    });
  });

  it("does not consume streaming JSON media types", async () => {
    let parsed = false;
    const response = {
      ok: true,
      headers: { get: () => "application/x-ndjson" },
      clone: () => ({
        json: async () => {
          parsed = true;
          return { error: "late stream error" };
        },
      }),
    };

    expect(await detectUpstreamError(response)).toBeNull();
    expect(parsed).toBe(false);
  });
});
