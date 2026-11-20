import { afterEach, expect, it, vi } from "vitest";
import { getKiroUsage } from "../../open-sse/services/usage/kiro.js";
import { fetchKiroProfileArn } from "../../src/lib/oauth/providerHelpers.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("identifies every quota attempt with the current Kiro client", async () => {
  vi.mocked(proxyAwareFetch).mockResolvedValue({ ok: false, status: 500, text: async () => "" });
  await getKiroUsage("secret", {});
  expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  for (const [, options] of vi.mocked(proxyAwareFetch).mock.calls) {
    expect(options.headers["User-Agent"]).toContain("KiroIDE-1.4.154-");
    expect(options.headers["x-amz-user-agent"]).not.toContain("secret");
  }
});
it("identifies profile discovery with the current Kiro client", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ profiles: [] }) });
  vi.stubGlobal("fetch", fetch);
  await fetchKiroProfileArn("secret");
  expect(fetch.mock.calls[0][1].headers["User-Agent"]).toContain("KiroIDE-1.4.154-");
});
