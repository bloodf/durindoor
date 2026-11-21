import { describe, expect, it, vi } from "vitest";
import TencentAIStudioWebExecutor from "../../open-sse/executors/tencent-aistudio-web.js";
import provider, { cookieCaptureProfile } from "../../open-sse/providers/private/tencent-aistudio-web.js";

describe("Tencent AI Studio Web staged provider", () => {
  it("exports the cookie capture profile and model discovery metadata", () => {
    expect(cookieCaptureProfile.domains).toEqual(["aistudio.tencent.ai"]);
    expect(provider.models.map(({ id }) => id)).toEqual(["hy3-g", "hunyuan-default", "hunyuan-3d"]);
    expect(provider.transport.executor).toBe("tencent-aistudio-web");
  });
  it("rejects missing cookies and routes a cookie authenticated chat request", async () => {
    const executor = new TencentAIStudioWebExecutor();
    const absent = await executor.execute({ model: "hy3-g", body: {}, credentials: {} });
    expect(absent.response.status).toBe(401);
    const fetcher = vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [] }))));
    try {
      await executor.execute({ model: "hunyuan-3d", body: { messages: [{ role: "user", content: "hello" }] }, credentials: { apiKey: "sessionid=synthetic" } });
      expect(fetch).toHaveBeenCalledWith("https://aistudio.tencent.ai/api/chat/Hunyuan3D", expect.objectContaining({ method: "POST" }));
    } finally { vi.unstubAllGlobals(); }
  });
});
