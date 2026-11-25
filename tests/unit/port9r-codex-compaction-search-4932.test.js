import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn(async () => new Response("", { status: 200 })) }));
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

const search = { type: "web_search_call", id: "ws_fixture", status: "completed", action: { type: "search", query: "fixture" } };
const summarize = { type: "message", role: "user", content: [{ type: "input_text", text: "Summarize for continuation." }] };
const runTool = { type: "function", name: "run", parameters: { type: "object", properties: {} } };
const transform = (body) => new CodexExecutor().transformRequest("gpt-5.6-sol", body, true, {});

describe("upstream #4932: tool-free compaction keeps search history without allowing tool calls", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network is disabled in this test"); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("declares hosted search and forbids tool execution on the standard transport", async () => {
    await new CodexExecutor().execute({
      model: "gpt-5.6-sol",
      body: { input: [search, summarize], tools: [], tool_choice: "auto" },
      stream: true,
      credentials: { accessToken: "test" },
      requestContext: { clientHeaders: { "x-openai-internal-codex-responses-lite": "true" } },
    });

    const [, options] = vi.mocked(proxyAwareFetch).mock.calls.at(-1);
    const body = JSON.parse(options.body);
    expect(options.headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.tool_choice).toBe("none");
    expect(body.input.some((item) => item.type === "web_search_call")).toBe(true);
  });

  it("keeps a migrated Lite prefix declared but not callable", () => {
    const body = transform({ input: [{ type: "additional_tools", tools: [runTool] }, search], tools: [] });

    expect(body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "run" }), { type: "web_search" }]));
    expect(body.tool_choice).toBe("none");
  });

  it("keeps the caller's tool choice when tools are active", () => {
    expect(transform({ input: [search], tools: [runTool], tool_choice: "auto" }).tool_choice).toBe("auto");
  });

  it("keeps the caller's tool choice when no tools field was sent", () => {
    expect(transform({ input: [search], tool_choice: "auto" }).tool_choice).toBe("auto");
  });

  it("does not touch tool-free requests without search history", () => {
    expect(transform({ input: [summarize], tools: [] }).tool_choice).toBeUndefined();
  });
});
