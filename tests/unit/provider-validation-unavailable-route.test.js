import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
const { providerValidationOutcome } = await import("@/shared/utils/providerValidationOutcome.js");
const { POST } = await import("@/app/api/providers/validate/route.js");
afterAll(() => vi.unstubAllGlobals());

describe("provider validation API outage evidence", () => {
  it.each(["wafer", "qiniu"])("preserves unavailability from the %s probe", async (provider) => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }));
    const result = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider, apiKey: "test-key" }) }));
    expect(await result.json()).toMatchObject({ valid: false, unavailable: true, error: "Provider unavailable - try again later" });
  });
  it.each(["wafer", "qiniu", "gitlawb-gmi"])("keeps %s network failures unavailable through the add/edit outcome", async (provider) => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const result = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider, apiKey: "test-key" }) }));
    const data = await result.json();
    expect(data).toEqual({ valid: false, unavailable: true, error: "Provider unavailable - network request failed" });
    expect(providerValidationOutcome(data)).toBe("unavailable");
  });
  it.each([401, 403])("keeps HTTP %s as invalid credentials", async (status) => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status }));
    const result = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider: "wafer", apiKey: "test-key" }) }));
    const data = await result.json();
    expect(data).toMatchObject({ valid: false, error: "Invalid API key" });
    expect(data.unavailable).not.toBe(true);
  });
  it("reports ChatGPT Web server errors as unavailable rather than rejected credentials", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }));
    const result = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider: "chatgpt-web", apiKey: "test-token" }) }));
    expect(await result.json()).toEqual({ valid: false, unavailable: true, error: "Provider unavailable - try again later" });
  });
});
