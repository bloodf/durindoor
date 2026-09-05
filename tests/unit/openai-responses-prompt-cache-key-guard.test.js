import { describe, expect, it, vi } from "vitest";

import { AzureExecutor } from "../../open-sse/executors/azure.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const promptCacheKey = "opaque cache key / exact value";

const chatBody = () => ({
  model: "example-model",
  messages: [{ role: "user", content: "hello" }],
  prompt_cache_key: promptCacheKey,
});
const responsesBody = () => ({
  model: "example-model",
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
  prompt_cache_key: promptCacheKey,
});

async function wireBody(executor, body, credentials = {}) {
  let sent;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response("{}", { status: 200 });
  }));
  try {
    await executor.execute({
      model: "example-model",
      body,
      stream: false,
      credentials,
      log: { debug: () => {} },
    });
  } finally {
    vi.unstubAllGlobals();
  }
  return sent;
}

describe("prompt_cache_key final wire guard", () => {
  it.each([
    ["Chat", chatBody],
    ["Responses", responsesBody],
  ])("strips strict Azure %s requests on its registered executor", async (_format, body) => {
    const sent = await wireBody(new AzureExecutor(), body());

    expect(sent).toBeDefined();
    expect(sent.prompt_cache_key).toBeUndefined();
  });

  it.each([
    ["OpenAI", new DefaultExecutor("openai"), chatBody],
    ["OpenAI Responses", new DefaultExecutor("openai"), responsesBody],
    ["Codex", new CodexExecutor(), responsesBody],
  ])("preserves opaque key on opted-in %s wire", async (_provider, executor, body) => {
    const sent = await wireBody(executor, body());

    expect(sent.prompt_cache_key).toBe(promptCacheKey);
  });

  it("fails closed when selected transport quirks are malformed", async () => {
    const transport = { format: FORMATS.OPENAI };
    Object.defineProperty(transport, "quirks", {
      get() {
        throw new Error("malformed transport");
      },
    });

    const sent = await wireBody(
      new DefaultExecutor("openai-compatible-strict"),
      chatBody(),
      { runtimeTransport: transport },
    );

    expect(sent.prompt_cache_key).toBeUndefined();
  });
});
