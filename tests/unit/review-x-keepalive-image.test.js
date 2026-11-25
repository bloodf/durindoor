import { afterEach, describe, expect, it, vi } from "vitest";
import { withEarlyJsonKeepalive } from "../../open-sse/utils/earlyJsonKeepalive.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), refresh: vi.fn() }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ execute: mocks.execute }) }));
vi.mock("@/shared/services/providerCredentials.js", () => ({ refreshAntigravityConnection: mocks.refresh }));
vi.mock("../../src/sse/services/auth.js", () => ({ projectProviderCredentials: vi.fn() }));

import { leasedAntigravityRefresher } from "../../src/sse/handlers/media/antigravityRefresh.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("late keepalive and image refresh regressions", () => {
  it("keeps normal CORS on an early response carrying late JSON", async () => {
    vi.useFakeTimers();
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const wrapped = withEarlyJsonKeepalive(pending, { thresholdMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    const response = await wrapped;
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    finish(Response.json({ error: "late" }, { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }));
    expect(await response.json()).toEqual({ error: "late" });
  });

  it.each([401, 403])("returns upstream %s when the leased refresh rejects", async (status) => {
    mocks.execute.mockResolvedValue({ response: new Response("upstream denied", { status }) });
    mocks.refresh.mockRejectedValue(new Error("lease failed"));
    const credentials = { accessToken: "old", _connection: { id: "fixture", provider: "antigravity" } };
    const result = await handleImageGenerationCore({
      body: { prompt: "fixture" }, modelInfo: { provider: "antigravity", model: "fixture" }, credentials,
      refreshCredentials: leasedAntigravityRefresher(credentials)
    });
    expect(result.status).toBe(status);
    expect(result.response.status).toBe(status);
    expect(await result.response.text()).toContain("upstream denied");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
