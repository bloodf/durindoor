import { describe, expect, it, vi } from "vitest";

// End-to-end execute() wiring: BaseExecutor.execute must run the clamp on the
// transformed body BEFORE dispatch — proven by inspecting the fetched payload.
describe("execute() clamps transformed bodies before dispatch", () => {
  it("caps max_tokens in the outgoing fetch body (DefaultExecutor path)", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const ex = new DefaultExecutor("openai-compatible-abc");
    let sent = null;
    const fakeFetch = vi.fn(async (url, init) => {
      sent = JSON.parse(init.body);
      return new Response("{}", { status: 500 }); // stop after first attempt
    });
    vi.stubGlobal("fetch", fakeFetch);
    try {
      await ex.execute({
        model: "custom-x",
        body: { max_tokens: 9000, messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: "k", providerSpecificData: { baseUrl: "http://127.0.0.1:9" } },
        log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        requestContext: { modelCapabilities: { maxOutput: 2048 } },
      }).catch(() => {});
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sent).not.toBeNull();
    expect(sent.max_tokens).toBeLessThanOrEqual(2048);
  });
});
