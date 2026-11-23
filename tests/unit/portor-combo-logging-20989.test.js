import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({ getComboByName: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({}));
import { getComboByName } from "@/lib/localDb";
import { getComboRoutingPolicy, mergeComboRouting } from "../../open-sse/services/comboRoutingPolicy.js";
import { buildRequestDetail } from "../../open-sse/handlers/chatCore/requestDetail.js";

describe("combo payload logging", () => {
  it("resolves strict opt-out and preserves it across nested combos", async () => {
    getComboByName.mockResolvedValue({ id: "outer", name: "outer", noLog: true });
    const outer = await getComboRoutingPolicy("outer");
    expect(outer.noLog).toBe(true);
    expect(mergeComboRouting(outer, { id: "inner", noLog: false }).noLog).toBe(true);
    expect(mergeComboRouting({ id: "outer", noLog: false }, { id: "inner", noLog: true }).noLog).toBe(true);
    getComboByName.mockResolvedValue({ id: "other", name: "other", noLog: "true" });
    expect((await getComboRoutingPolicy("other")).noLog).toBe(false);
  });

  it("removes payloads after overrides while retaining usage metadata", () => {
    const base = { provider: "test", model: "model", comboNoLog: true, tokens: { prompt_tokens: 3 }, request: { secret: 1 }, providerRequest: "secret", providerResponse: "secret", response: { content: "secret" } };
    const detail = buildRequestDetail(base, { response: { content: "override secret" }, endpoint: "/v1/chat" });
    expect(detail).toMatchObject({ provider: "test", model: "model", tokens: { prompt_tokens: 3 }, endpoint: "/v1/chat", request: null, providerRequest: null, providerResponse: null, response: {} });
    expect(buildRequestDetail({ ...base, comboNoLog: false }).request).toEqual({ secret: 1 });
  });
});

it("passes the opt-out into every request-detail construction site", async () => {
  const { readFileSync } = await import("node:fs");
  const sites = [
    ["../../open-sse/handlers/chatCore.js", 3],
    ["../../open-sse/handlers/chatCore/streamingHandler.js", 3],
    ["../../open-sse/handlers/chatCore/sseToJsonHandler.js", 3],
    ["../../open-sse/handlers/chatCore/nonStreamingHandler.js", 1],
  ];
  for (const [file, count] of sites) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source.match(/saveRequestDetail\(buildRequestDetail\(\{/g)).toHaveLength(count);
    expect(source.match(/saveRequestDetail\(buildRequestDetail\(\{\s*comboNoLog,/g)).toHaveLength(count);
  }
});
