import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const { handleVideoProxyCore } = await import("../../open-sse/handlers/videoCore.js");
const { MAX_PROVIDER_BODY_BYTES } = await import("../../open-sse/config/runtimeConfig.js");

/** A body that never ends, so only a bounded reader can finish with it. */
function endlessResponse(status) {
  const chunk = new Uint8Array(1024 * 1024).fill(97);
  const state = { cancelled: false, pulled: 0 };
  const body = new ReadableStream({
    pull(controller) {
      state.pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() { state.cancelled = true; },
  });
  return { response: new Response(body, { status }), state };
}

const poll = () => handleVideoProxyCore({ provider: "xai", requestId: "job-1", credentials: { apiKey: "xai-test-key" } });

beforeEach(() => proxyAwareFetch.mockReset());

describe("OmniRoute #19629 bounded video provider responses", () => {
  it.each([
    [200, 502],
    [429, 429],
  ])("cancels an oversized %s body and returns a bounded %s error", async (upstream, expected) => {
    const { response, state } = endlessResponse(upstream);
    proxyAwareFetch.mockResolvedValue(response);
    const result = await poll();
    expect(result.success).toBe(false);
    expect(result.status).toBe(expected);
    expect(result.error).toContain("exceeded");
    expect(result.error.length).toBeLessThan(200);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThanOrEqual(MAX_PROVIDER_BODY_BYTES + 3 * 1024 * 1024);
  });

  it("passes a body under the cap through unchanged", async () => {
    const body = JSON.stringify({ request_id: "job-1", status: "processing" });
    proxyAwareFetch.mockResolvedValue(new Response(body, { status: 200 }));
    const result = await poll();
    expect(result.success).toBe(true);
    expect(await result.response.text()).toBe(body);
  });
});
