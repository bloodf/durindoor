import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import { translateRequest } from "../../open-sse/translator/index.js";

/** The body a request has when it leaves for the upstream, using the route chatCore resolves. */
function wireBody(provider, alias, model, sourceFormat, body) {
  const credentials = { apiKey: "test-key", providerSpecificData: {} };
  const { runtimeTransport, targetFormat } = resolveRequestTransport({ provider, alias, model, sourceFormat, credentials });
  expect(targetFormat).toBe("openai-responses");
  if (runtimeTransport) credentials.runtimeTransport = runtimeTransport;
  const translated = translateRequest(sourceFormat, targetFormat, model, body, true, credentials, provider);
  return getExecutor(provider).transformRequest(model, translated, true, credentials);
}

const requests = {
  openai: () => ({ messages: [{ role: "user", content: "Hello" }], reasoning_effort: "high" }),
  "openai-responses": () => ({ input: [{ role: "user", content: "Hello" }], reasoning: { effort: "high" } }),
};

describe("Responses reasoning.effort wire shape (upstream decolua/9router#4610)", () => {
  it.each([
    ["opencode-zen", "opencode-zen", "gpt-5.1-codex", "openai"],
    ["opencode-zen", "opencode-zen", "gpt-5.1-codex", "openai-responses"],
    ["xai", "xai", "grok-4.20-multi-agent", "openai"],
    ["xai", "xai", "grok-4.7", "openai-responses"],
  ])("%s %s/%s from a %s client", (provider, alias, model, sourceFormat) => {
    const wire = wireBody(provider, alias, model, sourceFormat, requests[sourceFormat]());

    expect(wire.reasoning).toMatchObject({ effort: "high" });
    expect(wire).not.toHaveProperty("reasoning_effort");
  });

  it("keeps flat reasoning_effort on the xAI chat route", () => {
    const wire = getExecutor("xai").transformRequest("grok-4.3", requests.openai(), true, { apiKey: "test-key" });

    expect(wire.reasoning_effort).toBe("high");
    expect(wire).not.toHaveProperty("reasoning");
  });
});
