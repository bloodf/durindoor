import { afterEach, expect, it, vi } from "vitest";
import { VertexExecutor } from "../../open-sse/executors/vertex.js";

afterEach(() => vi.unstubAllGlobals());

it("strips trailing model turns only for restricted Vertex Gemini chat models", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  const contents = [{ role: "user", parts: [{ text: "hi" }] }, { role: "model", parts: [{ text: "prefill" }] }, { role: "model", parts: [{ text: "more" }] }];
  for (const [model, expected] of [["gemini-3.1-pro-preview", 1], ["gemini-4-argon", 1], ["gemini-2.5-flash", 3], ["gemini-3.1-flash-image", 3]]) {
    await new VertexExecutor("vertex").execute({ model, body: { contents }, stream: false, credentials: { apiKey: "test" }, proxyOptions: { disableEnvProxy: true } });
    expect(JSON.parse(fetch.mock.lastCall[1].body).contents).toHaveLength(expected);
    expect(contents).toHaveLength(3);
  }
});
