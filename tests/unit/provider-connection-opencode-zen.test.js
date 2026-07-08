import { describe, expect, it, vi, afterEach } from "vitest";
import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { getProviderConnectionById } from "@/lib/localDb";

const originalFetch = global.fetch;

describe("OpenCode Zen connection test", () => {
  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it("probes /zen/v1/chat/completions and returns valid on 200", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "zen-conn",
      provider: "opencode-zen",
      authType: "apikey",
      apiKey: "zen-key",
      providerSpecificData: {},
      defaultModel: "big-pickle",
    });

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
    });

    const result = await testSingleConnection("zen-conn");

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();

    const chatCall = global.fetch.mock.calls.find((c) =>
      c[0].includes("opencode.ai/zen/v1/chat/completions")
    );
    expect(chatCall).toBeTruthy();
    const [, init] = chatCall;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer zen-key",
    });
    expect(init.body).toContain("big-pickle");
  });
});
