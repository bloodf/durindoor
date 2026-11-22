import { describe, expect, it, vi } from "vitest";
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn(async () => new Response("", { status: 200 })) }));
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

describe("Codex search history", () => {
  it("declares hosted search and keeps prefix tools", () => {
    const body = { input: [{ type: "additional_tools", tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }] }, { type: "web_search_call", id: "search_1" }] };
    const result = new CodexExecutor().transformRequest("gpt-5", body, true, {});
    expect(result.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function", name: "lookup" }), { type: "web_search" }]));
    expect(result.input.some((item) => item.type === "web_search_call")).toBe(true);
    expect(result.input.some((item) => item.type === "additional_tools")).toBe(false);
  });
  it("uses the standard transport when a Lite request replays search", async () => {
    await new CodexExecutor().execute({ model: "gpt-5", body: { input: [{ type: "web_search_call", id: "search_1" }] }, stream: true, credentials: { accessToken: "test" }, requestContext: { clientHeaders: { "x-openai-internal-codex-responses-lite": "true" } } });
    const [, options] = vi.mocked(proxyAwareFetch).mock.calls.at(-1);
    expect(options.headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
    expect(JSON.parse(options.body).tools).toContainEqual({ type: "web_search" });
  });
});
