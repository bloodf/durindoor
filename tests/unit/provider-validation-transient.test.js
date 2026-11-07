import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
const { probeRegistryProvider } = await import("../../src/app/api/providers/providerProbe.js");
afterAll(() => vi.unstubAllGlobals());

describe("provider validation during upstream outages", () => {
  it.each([500, 502, 503, 504])("does not validate Claude credentials on HTTP %s", async (status) => {
    const result = await probeRegistryProvider("wafer", "test-key", async () => ({ ok: false, status }));
    expect(result).toMatchObject({ valid: false, status, error: "Provider unavailable - try again later" });
  });

  it.each([500, 502, 503, 504])("does not validate fallback credentials on HTTP %s", async (status) => {
    const result = await probeRegistryProvider("qiniu", "test-key", async () => ({ ok: false, status }));
    expect(result).toMatchObject({ valid: false, status, error: "Provider unavailable - try again later" });
  });

  it("keeps a successful fallback distinct from an unavailable catalog", async () => {
    let calls = 0;
    const result = await probeRegistryProvider("qiniu", "test-key", async () => ++calls === 1
      ? { ok: false, status: 503 }
      : { ok: true, status: 200 });
    expect(result).toMatchObject({ valid: true, status: 200 });
  });
});
