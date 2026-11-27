import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: proxyAwareFetchMock,
}));

import {
  modalitiesFromModelEntry,
  getNodeReportedModalities,
  withNodeModalities,
  hasStripEligibleMedia,
  _resetNodeModalitiesCache,
} from "../../open-sse/providers/nodeModalities.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

const P = "openai-compatible-chat-11111111-2222-3333-4444-555555555555";
const A = "anthropic-compatible-11111111-2222-3333-4444-555555555555";
const CREDS = { id: "conn-1", apiKey: "k-one", providerSpecificData: { baseUrl: "http://node.local/v1/" } };
const MLX_SERVE = {
  data: [
    { id: "mlx-community/Inkling-2-Mini-4bit", capabilities: ["chat", "tool_use", "vision"], input_modalities: ["text", "image"] },
    { id: "text-only", input_modalities: ["text"] },
  ],
};
const okJson = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));

describe("9router #5818 compatible-node modality discovery", () => {
  beforeEach(() => {
    _resetNodeModalitiesCache();
    proxyAwareFetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts modalities from /models, gateway, models.dev, capability, and LM Studio shapes", () => {
    expect(modalitiesFromModelEntry({ input_modalities: ["text", "image"] })).toEqual({ vision: true });
    expect(modalitiesFromModelEntry({ architecture: { input_modalities: ["text", "image", "audio", "file"] } }))
      .toEqual({ vision: true, audioInput: true, pdf: true });
    expect(modalitiesFromModelEntry({ modalities: { input: ["text", "pdf"] } })).toEqual({ pdf: true });
    expect(modalitiesFromModelEntry({ capabilities: ["completion", "vision"] })).toEqual({ vision: true });
    expect(modalitiesFromModelEntry({ id: "qwen2.5-vl-7b", type: "vlm" })).toEqual({ vision: true });
    expect(modalitiesFromModelEntry({ id: "llama", type: "llm" })).toBeNull();
    expect(modalitiesFromModelEntry({ id: "x" })).toBeNull();
    expect(modalitiesFromModelEntry(null)).toBeNull();
  });

  it("probes /models with bearer auth, caches per connection scope, and skips non-compatible providers", async () => {
    const f = okJson(MLX_SERVE);
    expect(await getNodeReportedModalities(P, "mlx-community/Inkling-2-Mini-4bit", CREDS, f)).toEqual({ vision: true });
    expect(await getNodeReportedModalities(P, "text-only", CREDS, f)).toEqual({});
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("http://node.local/v1/models");
    expect(f.mock.calls[0][1].headers.authorization).toBe("Bearer k-one");
    expect(f.mock.calls[0][1].redirect).toBe("manual");

    expect(await getNodeReportedModalities("openai", "gpt-x", CREDS, f)).toBeNull();
    expect(await getNodeReportedModalities(P, "m", {}, f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("isolates caches across sibling connections with different credentials or baseUrls", async () => {
    const f = vi.fn(async (url, init) => {
      if (init.headers.authorization === "Bearer k-vision") {
        return { ok: true, json: async () => ({ data: [{ id: "shared-model", input_modalities: ["text", "image"] }] }) };
      }
      return { ok: true, json: async () => ({ data: [{ id: "shared-model", input_modalities: ["text"] }] }) };
    });
    const visionCreds = { id: "conn-a", apiKey: "k-vision", providerSpecificData: { baseUrl: "http://node.local/v1" } };
    const textCreds = { id: "conn-b", apiKey: "k-text", providerSpecificData: { baseUrl: "http://node.local/v1" } };

    expect(await getNodeReportedModalities(P, "shared-model", visionCreds, f)).toEqual({ vision: true });
    expect(await getNodeReportedModalities(P, "shared-model", textCreds, f)).toEqual({});
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("falls back to LM Studio /api/v0/models and Ollama /api/show on the same origin", async () => {
    const route = (map) => vi.fn(async (url, init) => {
      const body = map[url];
      if (typeof body === "function") return { ok: true, json: async () => body(init) };
      return body ? { ok: true, json: async () => body } : { ok: false, json: async () => ({}) };
    });

    const lmsFetch = route({
      "http://lms:1234/v1/models": { data: [{ id: "qwen2.5-vl-7b" }] },
      "http://lms:1234/api/v0/models": { data: [{ id: "qwen2.5-vl-7b", type: "vlm" }] },
    });
    expect(await getNodeReportedModalities(P, "qwen2.5-vl-7b", {
      providerSpecificData: { baseUrl: "http://lms:1234/v1" },
    }, lmsFetch)).toEqual({ vision: true });
    expect(lmsFetch.mock.calls[0][1].headers.authorization).toBeUndefined();

    const ollamaFetch = route({
      "http://ollama:11434/v1/models": { data: [{ id: "gemma3:12b" }] },
      "http://ollama:11434/api/show": (init) => (JSON.parse(init.body).model === "gemma3:12b"
        ? { capabilities: ["completion", "vision"] }
        : {}),
    });
    const ollamaCreds = { providerSpecificData: { baseUrl: "http://ollama:11434/v1" } };
    expect(await getNodeReportedModalities(P, "gemma3:12b", ollamaCreds, ollamaFetch)).toEqual({ vision: true });
    expect(await getNodeReportedModalities(P, "gemma3:12b", ollamaCreds, ollamaFetch)).toEqual({ vision: true });
    expect(ollamaFetch.mock.calls.filter(([u]) => u.endsWith("/api/show"))).toHaveLength(1);
  });

  it("falls back per requested model when /models describes only other models", async () => {
    const lists = {
      "http://localhost:1234/v1/models": { data: [{ id: "text-model", input_modalities: ["text"] }, { id: "vision-model" }] },
      "http://localhost:1234/api/v0/models": { data: [{ id: "vision-model", type: "vlm" }] },
    };
    const f = vi.fn(async (url) => ({ ok: Boolean(lists[url]), json: async () => lists[url] || {} }));
    const creds = { providerSpecificData: { baseUrl: "http://localhost:1234/v1" } };

    expect(await getNodeReportedModalities(P, "vision-model", creds, f)).toEqual({ vision: true });
    expect(await getNodeReportedModalities(P, "vision-model", creds, f)).toEqual({ vision: true });
    expect(f.mock.calls.map(([u]) => u)).toEqual(Object.keys(lists));
  });

  it("lets the requested model's own /models metadata win over LM Studio and Ollama", async () => {
    const f = vi.fn(async (url) => ({
      ok: true,
      json: async () => (url.endsWith("/v1/models")
        ? { data: [{ id: "text-model", input_modalities: ["text"] }, { id: "vision-model" }] }
        : { data: [{ id: "text-model", type: "vlm" }], capabilities: ["vision"] }),
    }));
    const creds = { providerSpecificData: { baseUrl: "http://localhost:1234/v1" } };

    expect(await getNodeReportedModalities(P, "text-model", creds, f)).toEqual({});
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("uses x-api-key and normalizes /messages baseUrl for anthropic-compatible nodes", async () => {
    const f = okJson({ data: [{ id: "custom-vision", input_modalities: ["text", "image"] }] });
    const creds = { apiKey: "anth-secret", providerSpecificData: { baseUrl: "https://node.example/v1/messages" } };
    expect(await getNodeReportedModalities(A, "custom-vision", creds, f)).toEqual({ vision: true });
    expect(f.mock.calls[0][0]).toBe("https://node.example/v1/models");
    expect(f.mock.calls[0][1].headers["x-api-key"]).toBe("anth-secret");
    expect(f.mock.calls[0][1].headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("blocks cloud metadata URLs via outboundUrlGuard before calling fetch", async () => {
    const f = okJson(MLX_SERVE);
    const metaCreds = { apiKey: "k", providerSpecificData: { baseUrl: "http://169.254.169.254/latest/v1" } };
    expect(await getNodeReportedModalities(P, "mlx-community/Inkling-2-Mini-4bit", metaCreds, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("routes probes through proxyAwareFetch when connection proxy options are active", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    proxyAwareFetchMock.mockResolvedValue({
      ok: true,
      json: async () => MLX_SERVE,
    });
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.local:8080" };
    const result = await getNodeReportedModalities(P, "mlx-community/Inkling-2-Mini-4bit", CREDS, { proxyOptions });
    expect(result).toEqual({ vision: true });
    expect(proxyAwareFetchMock).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetchMock.mock.calls[0][2]).toEqual(proxyOptions);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("never turns declared capabilities off and preserves explicit customKeys overrides", () => {
    expect(withNodeModalities({ vision: true, pdf: false }, {})).toEqual({ vision: true, pdf: false });
    const caps = { vision: false, pdf: false };
    Object.defineProperty(caps, "customKeys", { value: new Set(["vision"]), enumerable: false });
    const merged = withNodeModalities(caps, { vision: true, pdf: true });
    expect(merged.vision).toBe(false);
    expect(merged.pdf).toBe(true);
  });

  it("keeps images in handleChatCore when a compatible node reports vision and skips probing text-only turns", async () => {
    const probeFetch = vi.fn(async () => ({ ok: true, json: async () => MLX_SERVE }));
    vi.stubGlobal("fetch", probeFetch);

    const dispatched = [];
    const executorOverride = {
      execute: vi.fn(async ({ body }) => {
        dispatched.push(structuredClone(body));
        return {
          response: new Response(JSON.stringify({
            id: "chatcmpl-1",
            object: "chat.completion",
            choices: [{ index: 0, message: { role: "assistant", content: "I see it" }, finish_reason: "stop" }],
          }), { status: 200, headers: { "Content-Type": "application/json" } }),
          url: "http://node.local/v1/chat/completions",
          headers: {},
          transformedBody: body,
        };
      }),
    };

    // Text-only turn: no probe call should happen.
    expect(hasStripEligibleMedia({ messages: [{ role: "user", content: "plain text" }] })).toBe(false);
    await handleChatCore({
      body: { model: "mlx-community/Inkling-2-Mini-4bit", stream: false, messages: [{ role: "user", content: "plain text" }] },
      modelInfo: { provider: P, model: "mlx-community/Inkling-2-Mini-4bit" },
      credentials: CREDS,
      executorOverride,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(probeFetch).not.toHaveBeenCalled();

    // Image turn: probes /models, keeps image_url intact.
    const model = "mlx-community/Inkling-2-Mini-4bit";
    expect(getCapabilitiesForModel(P, model).vision).toBe(false);
    await handleChatCore({
      body: {
        model,
        stream: false,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
          ],
        }],
      },
      modelInfo: { provider: P, model },
      credentials: CREDS,
      executorOverride,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(probeFetch).toHaveBeenCalledTimes(1);
    expect(dispatched[1].messages[0].content.map((b) => b.type)).toEqual(["text", "image_url"]);

    // Text-only model reported by the same node still strips images.
    const textCaps = withNodeModalities(
      getCapabilitiesForModel(P, "text-only"),
      await getNodeReportedModalities(P, "text-only", CREDS, probeFetch)
    );
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }] }] };
    stripUnsupportedModalities(body, FORMATS.OPENAI, textCaps);
    expect(body.messages[0].content.some((b) => b.type === "image_url")).toBe(false);
  });
});
