import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOllamaLocalHost } from "../../open-sse/config/providers.js";
import { discoverOllamaCatalog } from "../../open-sse/services/catalogs/ollamaCatalog.js";
import OllamaLocalExecutor from "../../open-sse/executors/ollama-local.js";
import embeddingAdapter from "../../open-sse/handlers/embeddingProviders/ollama-local.js";
import { probeConnectionHealth } from "../../src/lib/providerHealthProbe.js";

const servers = [];
async function mockOllama(model) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = {};
    if (req.url === "/api/tags") body = { models: [{ name: model, capabilities: ["completion"] }] };
    if (req.url === "/api/ps") body = { models: [] };
    if (req.url === "/api/chat") body = { model, message: { role: "assistant", content: "ok" }, done: true };
    if (req.url === "/api/embed") body = { model, embeddings: [[0.1, 0.2]] };
    if (req.url === "/v1/messages") body = { id: "msg", type: "message", content: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))));

describe("network Ollama hosts #2022", () => {
  it("normalizes endpoint suffixes and rejects invalid URLs clearly", () => {
    expect(resolveOllamaLocalHost({ providerSpecificData: { baseUrl: "http://ollama.test:11434/v1/" } })).toBe("http://ollama.test:11434");
    expect(resolveOllamaLocalHost({ providerSpecificData: { baseUrl: "https://ollama.test/api" } })).toBe("https://ollama.test");
    expect(() => resolveOllamaLocalHost({ providerSpecificData: { baseUrl: "file:///tmp/ollama" } })).toThrow("must use http or https");
    expect(() => resolveOllamaLocalHost({ providerSpecificData: { baseUrl: "not a URL" } })).toThrow("valid http(s) URL");
    expect(() => new OllamaLocalExecutor().buildUrl("model", false, 0, {
      providerSpecificData: { baseUrl: "not a URL" },
      runtimeTransport: { baseUrl: "http://localhost:11434/v1/messages" },
    })).toThrow("valid http(s) URL");
  });

  it("discovers each connection from its own /api/tags host", async () => {
    const [one, two] = await Promise.all([mockOllama("host-one-model"), mockOllama("host-two-model")]);
    const catalogs = await Promise.all([one, two].map((baseUrl) => {
      const host = resolveOllamaLocalHost({ providerSpecificData: { baseUrl } });
      return discoverOllamaCatalog({ host, accountId: host, fetchImpl: (path, init) => fetch(`${host}${path}`, init) });
    }));
    expect(catalogs.map((catalog) => catalog.models.map((model) => model.id))).toEqual([["host-one-model"], ["host-two-model"]]);
  });

  it("builds chat, Messages and embeddings URLs against the configured host", async () => {
    const host = await mockOllama("remote-model");
    const credentials = { providerSpecificData: { baseUrl: `${host}/api/` } };
    const executor = new OllamaLocalExecutor();
    expect(executor.buildUrl("remote-model", false, 0, credentials)).toBe(`${host}/api/chat`);
    expect(executor.buildUrl("remote-model", false, 0, { ...credentials, runtimeTransport: { baseUrl: "http://registry.invalid/v1/messages" } })).toBe(`${host}/v1/messages`);
    expect(embeddingAdapter.buildUrl("remote-model", credentials)).toBe(`${host}/api/embed`);
    const [chat, messages, embedding] = await Promise.all([
      fetch(executor.buildUrl("remote-model", false, 0, credentials), { method: "POST" }),
      fetch(executor.buildUrl("remote-model", false, 0, { ...credentials, runtimeTransport: { baseUrl: "http://registry.invalid/v1/messages" } }), { method: "POST" }),
      fetch(embeddingAdapter.buildUrl("remote-model", credentials), { method: "POST" }),
    ]);
    expect([chat.status, messages.status, embedding.status]).toEqual([200, 200, 200]);
  });

  it("probes /api/tags and distinguishes healthy, HTTP error and unreachable hosts", async () => {
    const baseUrl = await mockOllama("health-model");
    const calls = [];
    const fetcher = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200 };
    };
    const result = await probeConnectionHealth({ provider: "ollama-local", providerSpecificData: { baseUrl } }, { fetcher, proxyConfig: null });
    expect(result.valid).toBe(true);
    expect(calls).toEqual([`${baseUrl}/api/tags`]);

    const httpError = await probeConnectionHealth({ provider: "ollama-local", providerSpecificData: { baseUrl } }, { fetcher: async () => ({ ok: false, status: 500 }), proxyConfig: null });
    expect(httpError).toMatchObject({ valid: false, status: 500 });
    const unreachable = await probeConnectionHealth({ provider: "ollama-local", providerSpecificData: { baseUrl } }, { fetcher: async () => { throw new Error("connect failed"); }, proxyConfig: null });
    expect(unreachable).toMatchObject({ valid: false, status: null, error: "connect failed" });
  });
});
