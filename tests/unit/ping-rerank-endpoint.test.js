import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PR #139 review (Codex): pingModelByKind used to fall every non-embedding/
// image/stt kind through to POST /api/v1/chat/completions, so testing a
// rerank-only model reported a chat-completion failure. Pin the new rerank
// branch: it MUST hit /api/v1/rerank and MUST NOT hit chat completions.
const mocks = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

const originalFetch = global.fetch;

describe("pingModelByKind rerank endpoint", () => {
  let calls;

  beforeEach(() => {
    vi.resetModules();
    mocks.getApiKeys.mockResolvedValue([]);
    mocks.getConsistentMachineId.mockResolvedValue("machine-id-test");
    calls = [];
    global.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ results: [{ index: 0, relevance_score: 0.9 }] }),
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calls POST /api/v1/rerank, not /api/v1/chat/completions", async () => {
    const { pingModelByKind } = await import(
      "../../src/app/api/models/test/ping.js"
    );
    const result = await pingModelByKind(
      "openrouter/cohere/rerank-4-pro",
      "rerank",
      "http://local.test",
    );

    expect(result.ok).toBe(true);
    expect(calls.some((u) => u === "http://local.test/api/v1/rerank")).toBe(true);
    expect(calls.some((u) => u.endsWith("/api/v1/chat/completions"))).toBe(false);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("http://local.test/api/v1/rerank");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "openrouter/cohere/rerank-4-pro",
      query: "ping",
      documents: ["hello world"],
      top_n: 1,
    });
  });
});
