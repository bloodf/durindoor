import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({ getProviderNodeById: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => Response.json(body, init) },
}));

const { POST } = await import("../../src/app/api/providers/validate/route.js");

const validate = async (providerSpecificData) => {
  const response = await POST(new Request("http://localhost/api/providers/validate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google-pse", apiKey: "pse-test-key", providerSpecificData }),
  }));
  return { status: response.status, body: await response.json() };
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [] }))));
afterEach(() => vi.unstubAllGlobals());

describe("OmniRoute #19639 Google PSE validation base URL", () => {
  it("probes the base URL saved on the connection through the outbound guard", async () => {
    const result = await validate({ cx: "engine-id", baseUrl: " https://search.example.com/customsearch/v1/ " });
    expect(result.body.valid).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://search.example.com/customsearch/v1?key=pse-test-key&q=ping&cx=engine-id");
    expect(options.redirect).toBe("manual");
    expect(options.dispatcher).toBeDefined();
  });

  it("uses the registry URL when the saved base URL is blank", async () => {
    await validate({ cx: "engine-id", baseUrl: "   " });
    expect(fetch.mock.calls[0][0])
      .toBe("https://www.googleapis.com/customsearch/v1?key=pse-test-key&q=ping&cx=engine-id");
  });

  it.each(["http://127.0.0.1:8080/search", "http://169.254.169.254/latest"])(
    "refuses a private base URL before any request (%s)", async (baseUrl) => {
      const result = await validate({ cx: "engine-id", baseUrl });
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ valid: false, blocked: true });
      expect(fetch).not.toHaveBeenCalled();
    });

  it.each([302, 404])("rejects a saved base URL that answers %s", async (status) => {
    fetch.mockResolvedValueOnce(new Response(null, { status }));
    const result = await validate({ cx: "engine-id", baseUrl: "https://search.example.com/wrong" });
    expect(result.body.valid).toBe(false);
  });
});
