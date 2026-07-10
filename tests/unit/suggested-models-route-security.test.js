import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import {
  GET,
  isAllowedSuggestedModelsFetcher,
} from "../../src/app/api/providers/suggested-models/route.js";

const originalFetch = global.fetch;

function requestFor(url, type) {
  const requestUrl = new URL("http://localhost/api/providers/suggested-models");
  requestUrl.searchParams.set("url", url);
  requestUrl.searchParams.set("type", type);
  return new Request(requestUrl);
}

describe("suggested-models registry allowlist", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    "http://127.0.0.1:20127/private",
    "http://169.254.169.254/latest/meta-data/",
    "https://example.com/arbitrary-models",
  ])("rejects unregistered server-side fetch target %s", async (target) => {
    const response = await GET(requestFor(target, "openai"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Fetcher is not registered" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("requires the registry-declared filter type as part of the allowlist key", async () => {
    const fetcher = AI_PROVIDERS["api-airforce"].modelsFetcher;

    expect(isAllowedSuggestedModelsFetcher(fetcher.url, fetcher.type)).toBe(true);
    expect(isAllowedSuggestedModelsFetcher(fetcher.url, "openai-compatible")).toBe(false);
    const response = await GET(requestFor(fetcher.url, "openai-compatible"));
    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches an exact registry target without following redirects", async () => {
    const fetcher = AI_PROVIDERS["api-airforce"].modelsFetcher;
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ id: "model-1" }, { id: "text-embedding-3-small" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await GET(requestFor(fetcher.url, fetcher.type));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [{ id: "model-1", name: "model-1" }],
    });
    expect(global.fetch).toHaveBeenCalledWith(fetcher.url, { redirect: "error" });
  });
});
