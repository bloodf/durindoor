import { beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: network.fetch }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));

import { DefaultExecutor } from "open-sse/executors/default.js";
import { extractUsage } from "open-sse/utils/usageTracking.js";
import { parseModel } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { fetchConnectionModels } from "@/app/api/providers/[id]/models/fetchConnectionModels.js";
import { canDiscoverModels } from "@/lib/providerRouteHandlers.js";

const fixtures = [
  { id: "gemma", model: "mlx-community/gemma-4-26B-A4B-it-qat-q4_0-mlx-aligned", port: 11435 },
  { id: "qwen", model: "maglun/Qwen3.8-27B-MLX-Mixed-3.80bpw", port: 11436 },
];
const connection = ({ id, port }) => ({ id, provider: "mlx", apiKey: `synthetic-${id}`, providerSpecificData: { baseUrl: `http://localhost:${port}/v1` } });

beforeEach(() => network.fetch.mockReset());

describe("MLX independent connection parity", () => {
  it("retains one passthrough registry identity for both nested model IDs", () => {
    expect(REGISTRY.filter((entry) => entry.id.startsWith("mlx")).map((entry) => entry.id)).toEqual(["mlx"]);
    for (const { model } of fixtures) expect(parseModel(`mlx/${model}`)).toMatchObject({ provider: "mlx", model });
    expect(canDiscoverModels({ provider: "mlx" })).toBe(true);
  });

  it.each(fixtures)("discovers the $id connection's own model", async (fixture) => {
    network.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: fixture.model }] })));
    const result = await fetchConnectionModels(connection(fixture));
    expect(result.models).toEqual([{ id: fixture.model }]);
    expect(network.fetch).toHaveBeenCalledWith(`http://localhost:${fixture.port}/v1/models`, expect.objectContaining({ method: "GET", headers: { Authorization: `Bearer synthetic-${fixture.id}` }, redirect: "manual" }), {});
  });

  it("supports keyless discovery and reports upstream and network failures", async () => {
    network.fetch.mockResolvedValueOnce(new Response('{"data":[]}'));
    expect((await fetchConnectionModels({ provider: "mlx" })).models).toEqual([]);
    expect(network.fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8080/v1/models");
    expect(network.fetch.mock.calls[0][1].headers).toEqual({});
    network.fetch.mockResolvedValueOnce(new Response("bad", { status: 503 }));
    expect(await fetchConnectionModels(connection(fixtures[0]))).toEqual({ error: "Failed to fetch models: 503", status: 503 });
    network.fetch.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchConnectionModels(connection(fixtures[1]))).toEqual({ error: "Failed to fetch models", status: 500 });
  });

  it("blocks metadata targets before discovery reaches the transport", async () => {
    const result = await fetchConnectionModels({ provider: "mlx", providerSpecificData: { baseUrl: "http://169.254.169.254/v1" } });
    expect(result).toEqual({ error: "Failed to fetch models", status: 500 });
    expect(network.fetch).not.toHaveBeenCalled();
  });

  for (const fixture of fixtures) {
    it.each([false, true])(`dispatches ${fixture.id} JSON/SSE on its selected connection (stream=%s)`, async (stream) => {
      const usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 };
      const payload = { id: "fixture", model: fixture.model, choices: [], usage };
      const wire = stream ? `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n` : JSON.stringify(payload);
      network.fetch.mockResolvedValueOnce(new Response(wire, { headers: { "content-type": stream ? "text/event-stream" : "application/json" } }));
      const result = await new DefaultExecutor("mlx").execute({ model: fixture.model, stream, credentials: connection(fixture), body: { model: fixture.model, stream, messages: [{ role: "user", content: "Hi" }] }, requestPolicy: { maxTransportAttempts: 1 } });
      const [url, options] = network.fetch.mock.calls[0];
      expect(url).toBe(`http://localhost:${fixture.port}/v1/chat/completions`);
      expect(options.headers.Authorization).toBe(`Bearer synthetic-${fixture.id}`);
      expect(JSON.parse(options.body)).toMatchObject({ model: fixture.model, stream });
      expect(await result.response.text()).toBe(wire);
      expect(extractUsage(payload)).toMatchObject(usage);
    });
  }

  it("preserves upstream chat errors", async () => {
    network.fetch.mockResolvedValueOnce(new Response("unavailable", { status: 400 }));
    const fixture = fixtures[0];
    const result = await new DefaultExecutor("mlx").execute({ model: fixture.model, stream: false, credentials: connection(fixture), body: { model: fixture.model, messages: [] }, requestPolicy: { maxTransportAttempts: 1 } });
    expect(result.response.status).toBe(400);
    expect(await result.response.text()).toBe("unavailable");
  });
});
