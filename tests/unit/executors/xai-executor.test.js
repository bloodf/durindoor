import "../../translator/registerAll.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { proxyAwareFetch } from "../../../open-sse/utils/proxyFetch.js";
import { translateRequest } from "../../../open-sse/translator/index.js";
import { FORMATS } from "../../../open-sse/translator/formats.js";
import { getModelTargetFormat } from "../../../open-sse/config/providerModels.js";
import { XaiExecutor } from "../../../open-sse/executors/xai.js";

vi.mock("../../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

describe("XaiExecutor suffix parsing", () => {
  const exec = new XaiExecutor();

  test("parses -high suffix and strips it from model", () => {
    const body = { model: "grok-4-high", messages: [] };
    const out = exec.transformRequest("xai/grok-4-high", body);
    expect(out.model).toBe("grok-4");
    expect(out.reasoning_effort).toBe("high");
  });

  test("parses -low suffix", () => {
    const body = { model: "grok-4.3-low", messages: [] };
    const out = exec.transformRequest("xai/grok-4.3-low", body);
    expect(out.model).toBe("grok-4.3");
    expect(out.reasoning_effort).toBe("low");
  });
  test("strips reasoning_effort for grok-build", () => {
    const body = { model: "grok-build", reasoning_effort: "high", messages: [] };
    const out = exec.transformRequest("xai/grok-build", body);
    expect(out.reasoning_effort).toBeUndefined();
  });

  test("keeps reasoning_effort for grok-4.3", () => {
    const body = { model: "grok-4.3", reasoning_effort: "high", messages: [] };
    const out = exec.transformRequest("xai/grok-4.3", body);
    expect(out.reasoning_effort).toBe("high");
  });
});

// Port of OmniRoute#6709 (decolua/9router#2439, author: @ryanngit): xAI ships
// a native /v1/responses endpoint. grok-4.20-multi-agent-0309 is tagged
// targetFormat: "openai-responses" in the registry — it must dispatch to
// https://api.x.ai/v1/responses with a Responses-shaped body ({ input, no
// messages }), while a plain chat model keeps /v1/chat/completions and its
// messages body. The registry tag is the single source of truth shared by
// chatCore's body translation and XaiExecutor.buildUrl.
describe("XaiExecutor Responses routing (OmniRoute #6709)", () => {
  const exec = new XaiExecutor();

  beforeEach(() => {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });

  test("routes the Responses-tagged model to xAI's native /v1/responses with a Responses-shaped body", async () => {
    const model = "grok-4.20-multi-agent-0309";
    const chatBody = {
      model,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    };
    const translated = translateRequest(
      FORMATS.OPENAI,
      getModelTargetFormat("xai", model),
      model,
      chatBody,
      true,
    );

    await exec.execute({ model, body: translated, stream: true, credentials: { apiKey: "k" } });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/responses");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe(model);
    expect(Array.isArray(sent.input)).toBe(true);
    expect(sent.store).toBe(false);
    expect(sent.stream).toBe(true);
    expect(sent.messages).toBeUndefined();
  });

  test("keeps a plain chat model (grok-4) on /v1/chat/completions with a messages body", async () => {
    const model = "grok-4";
    const body = {
      model,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    };

    await exec.execute({ model, body, stream: true, credentials: { apiKey: "k" } });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe(model);
    expect(Array.isArray(sent.messages)).toBe(true);
    expect(sent.input).toBeUndefined();
  });
});

// xAI OAuth for grok-4.5 is Responses-only, while its API-key endpoint remains
// Chat Completions. chatCore marks only the OAuth dispatch with this transport.
describe("XaiExecutor OAuth Responses routing", () => {
  const exec = new XaiExecutor();

  beforeEach(() => {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });

  test("uses the OAuth-selected Responses endpoint for grok-4.5", async () => {
    await exec.execute({
      model: "grok-4.5",
      body: { model: "grok-4.5", input: [], stream: true },
      stream: true,
      credentials: {
        accessToken: "oauth-token",
        authType: "oauth",
        runtimeTransport: { format: "openai-responses-oauth", baseUrl: "https://api.x.ai/v1/responses" },
      },
    });

    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(JSON.parse(init.body)).toMatchObject({ model: "grok-4.5", input: [], stream: true });
    expect(init.headers.Authorization).toBe("Bearer oauth-token");
  });

  test("keeps API-key grok-4.5 on Chat Completions", async () => {
    await exec.execute({
      model: "grok-4.5",
      body: { model: "grok-4.5", messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: { apiKey: "api-key" },
    });

    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({ model: "grok-4.5", messages: [{ role: "user", content: "hi" }], stream: false });
    expect(init.headers.Authorization).toBe("Bearer api-key");
  });
});
