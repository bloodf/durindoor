import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
const { POST } = await import("@/app/api/providers/validate/route.js");
afterAll(() => vi.unstubAllGlobals());

describe("provider validation API outage evidence", () => {
  it.each(["wafer", "qiniu"])("preserves unavailability from the %s probe", async (provider) => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }));
    const result = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider, apiKey: "test-key" }) }));
    expect(await result.json()).toMatchObject({ valid: false, unavailable: true, error: "Provider unavailable - try again later" });
  });
  it.each([401, 403])("keeps HTTP %s as invalid credentials", async (status) => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status }));
    const result = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider: "wafer", apiKey: "test-key" }) }));
    const data = await result.json();
    expect(data).toMatchObject({ valid: false, error: "Invalid API key" });
    expect(data.unavailable).not.toBe(true);
  });
});
