// agy model discovery uses the same Hub client identity as the Antigravity
// quota call to fetchAvailableModels, not the stale vscode-antigravity UA.
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: mocks.fetch,
}));

const { PROVIDER_MODELS_CONFIG } = await import("../../src/app/api/providers/[id]/models/modelsConfig.js");

describe("agy model discovery identity", () => {
  it("sends the Hub User-Agent and client headers to PROD fetchAvailableModels", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ models: {} }), { status: 200 }));
    await PROVIDER_MODELS_CONFIG.agy.customResolver({ accessToken: "tok", providerSpecificData: { projectId: "p" } });
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels");
    expect(init.headers["User-Agent"]).toBe("antigravity/hub/2.24.0 darwin/arm64");
    expect(init.headers["X-Client-Name"]).toBe("antigravity");
    expect(init.headers["X-Client-Version"]).toBe("2.24.0");
    expect(JSON.parse(init.body)).toEqual({ project: "p" });
  });
});
