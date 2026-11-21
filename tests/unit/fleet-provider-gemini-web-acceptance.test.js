/**
 * Issue #1190 acceptance scope: offline native Gemini comparison and the registered
 * Gemini Web identity. Gemini Web / gweb is a distinct cookie-authenticated web UI
 * transport, not the installed Gemini API alias: it never sends its cookie to the
 * API host and the native API key never reaches gemini.google.com. Mocked responses
 * prove wire behavior, not account-backed support.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/providers/validate/route.js";
import { fetchConnectionModels } from "@/app/api/providers/[id]/models/fetchConnectionModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// Prevent unrelated executor imports from polling GitHub for a user-agent.
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-fixture",
  updateKimchiUserAgent: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => globalThis.fetch(...args),
}));

const model = "gemini-3.7-flash";
const credentials = { apiKey: "offline-fixture-key", providerSpecificData: {} };
const nativeBody = () => ({
  contents: [{ role: "user", parts: [{ text: "Weather in Oslo?" }] }],
  tools: [{ functionDeclarations: [{ name: "weather", parameters: {
    type: "OBJECT", properties: { city: { type: "STRING" } }, required: ["city"],
  } }] }],
});
const toolReply = { candidates: [{ content: { role: "model", parts: [
  { functionCall: { name: "weather", args: { city: "Oslo" } } },
] }, finishReason: "STOP" }] };

function validate(provider, apiKey = credentials.apiKey) {
  return POST(new Request("http://localhost/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey }),
  }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected offline fetch")));
});
afterEach(() => vi.unstubAllGlobals());

describe("#1190 Gemini Web identity boundary", () => {
  it("validates native Gemini API auth and keeps the web identity on its own read-only probe", async () => {
    fetch.mockResolvedValueOnce(Response.json({ models: [] }));
    expect(await (await validate("gemini")).json()).toEqual({ valid: true, error: null });
    expect(fetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1/models?key=offline-fixture-key",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fetch.mockClear();
    const cookie = "__Secure-1PSID=offline-psid; __Secure-1PSIDTS=offline-psidts";
    fetch.mockResolvedValueOnce(new Response('<html>{"SNlM0e":"token"}</html>', { status: 200 }));
    const response = await validate("gemini-web", cookie);
    expect(await response.json()).toMatchObject({ valid: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://gemini.google.com/app");
    expect(options.method).toBe("GET");
    expect(options.headers.Cookie).toBe(cookie);
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.headers["x-goog-api-key"]).toBeUndefined();
  });

  it("discovers native API models; gemini-web answers from its own catalog without a request", async () => {
    fetch.mockResolvedValueOnce(Response.json({ models: [{ name: `models/${model}` }] }));
    expect(await fetchConnectionModels({ id: "offline", provider: "gemini", ...credentials }))
      .toEqual({ models: [{ name: `models/${model}` }] });
    expect(fetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?key=offline-fixture-key&pageSize=1000",
      expect.objectContaining({ method: "GET" }), null,
    );
    fetch.mockClear();
    const web = await fetchConnectionModels({ id: "offline", provider: "gemini-web", ...credentials });
    expect(web).toMatchObject({ provider: "gemini-web", source: "local_catalog" });
    expect(web.models.map(({ id }) => id)).toEqual(["gemini-3.1-pro", "gemini-3.7-flash", "gemini-3.1-flash-lite"]);
    expect(AI_PROVIDERS["gemini-web"]).toMatchObject({ authType: "cookie" });
    expect(AI_PROVIDERS.gemini).not.toBe(AI_PROVIDERS["gemini-web"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends native function declarations with Google auth and retains a function-call reply", async () => {
    fetch.mockResolvedValueOnce(Response.json(toolReply));
    const body = nativeBody();
    const result = await getExecutor("gemini").execute({ model, body, stream: false, credentials });
    expect(result.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(result.url);
    expect(options.headers["x-goog-api-key"]).toBe(credentials.apiKey);
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.headers.cookie).toBeUndefined();
    expect(JSON.parse(options.body)).toEqual(body);
    expect(await result.response.json()).toEqual(toolReply);
  });

  it("preserves native SSE tool frames and propagates upstream auth errors", async () => {
    const sse = `data: ${JSON.stringify(toolReply)}\n\n`;
    fetch.mockResolvedValueOnce(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
    const executor = getExecutor("gemini");
    const result = await executor.execute({ model, body: nativeBody(), stream: true, credentials });
    expect(result.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`);
    expect(fetch.mock.calls[0][1].headers.Accept).toBe("text/event-stream");
    expect(await result.response.text()).toBe(sse);
    const error = { error: { code: 403, status: "PERMISSION_DENIED", message: "Fixture key denied" } };
    fetch.mockResolvedValueOnce(Response.json(error, { status: 403 }));
    const rejected = await executor.execute({ model, body: nativeBody(), stream: false, credentials });
    expect(rejected.response.status).toBe(403);
    expect(await rejected.response.json()).toEqual(error);
  });

  it.each(["gemini-web", "gweb"])("%s dispatches to the web executor, never to the API host or another vendor", async (provider) => {
    const executor = getExecutor(provider);
    expect(executor).toBe(getExecutor("gemini-web"));
    expect(executor).not.toBe(getExecutor("gemini"));
    expect(executor.constructor.name).toBe("GeminiWebExecutor");
    const url = executor.buildUrl(model, false, 0, credentials);
    expect(url).toBe("https://gemini.google.com/app");
    expect(fetch).not.toHaveBeenCalled();
  });
});
