// DurinDoor extension to upstream #3714: fetchPublic accepts `fetchImpl` so
// callers with a custom transport (the search dispatcher's per-connection
// proxyAwareFetch) keep per-hop SSRF re-validation. These tests pin that
// every redirect hop goes through the injected implementation and that
// hop targets are still validated before the injected fetch runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
  promises: { lookup: lookupMock },
}));

const { fetchPublic } = await import("../../src/shared/utils/ssrfGuard.js");

const redirect = (location) => new Response(null, { status: 302, headers: { location } });
const ok = () => new Response("ok", { status: 200 });

describe("fetchPublic fetchImpl (DurinDoor proxy routing)", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("routes every redirect hop through the injected fetchImpl", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(url);
      return calls.length === 1 ? redirect("https://cdn.example.com/final") : ok();
    });
    const res = await fetchPublic("https://example.com/start", {}, { fetchImpl });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["https://example.com/start", "https://cdn.example.com/final"]);
  });

  it("does not follow redirects itself when no fetchImpl is given", async () => {
    // Default path uses the global fetch; stub it to prove redirect:"manual"
    // is requested (an auto-following fetch would resolve the 302 away).
    const originalFetch = global.fetch;
    const seen = [];
    global.fetch = async (url, init) => {
      seen.push(init?.redirect);
      return ok();
    };
    try {
      await fetchPublic("https://example.com/");
      expect(seen).toEqual(["manual"]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rejects a redirect to an internal host before fetchImpl is called again", async () => {
    const fetchImpl = vi.fn(async () => redirect("http://169.254.169.254/latest/meta-data"));
    await expect(fetchPublic("https://example.com/", {}, { fetchImpl })).rejects.toThrow(/Blocked URL/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
