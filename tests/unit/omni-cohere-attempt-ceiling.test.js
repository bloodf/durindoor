import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
import { BaseExecutor } from "../../open-sse/executors/base.js";

const suggestion = "reasoning_effort low is unsupported. Use 'high' instead";
const request = (maxTransportAttempts) => ({
  model: "fixture", body: { reasoning_effort: "low", client_metadata: {}, messages: [] },
  stream: false, credentials: {}, requestPolicy: { maxTransportAttempts },
});
const executor = (config = {}) => new BaseExecutor("cohere", {
  baseUrl: "https://mock.invalid/v1/chat/completions", retry: {}, ...config,
});

beforeEach(() => fetchMock.mockReset());

describe("Cohere recovery transport ceiling", () => {
  it("returns the last 400 when effort recovery exhausted the budget", async () => {
    fetchMock.mockResolvedValueOnce(new Response(suggestion, { status: 422 }))
      .mockResolvedValueOnce(new Response("Unsupported field client_metadata", { status: 400 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const { response } = await executor().execute(request(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Unsupported field client_metadata");
  });

  it("permits both recoveries when a third dispatch is available", async () => {
    fetchMock.mockResolvedValueOnce(new Response(suggestion, { status: 422 }))
      .mockResolvedValueOnce(new Response("Unsupported field client_metadata", { status: 400 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const { response } = await executor().execute(request(3));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body.reasoning_effort).toBe("high");
    expect(body).not.toHaveProperty("client_metadata");
  });

  it("counts field stripping before a generic status retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unsupported field client_metadata", { status: 400 }))
      .mockResolvedValueOnce(new Response("failure", { status: 502 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const { response } = await executor({ retry: { 502: { attempts: 2, delayMs: 0 } } }).execute(request(2));
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains status retries when a recovery leaves enough budget", async () => {
    fetchMock.mockResolvedValueOnce(new Response(suggestion, { status: 422 }))
      .mockResolvedValueOnce(new Response("failure", { status: 502 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const { response } = await executor({ retry: { 502: { attempts: 1, delayMs: 0 } } }).execute(request(3));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
