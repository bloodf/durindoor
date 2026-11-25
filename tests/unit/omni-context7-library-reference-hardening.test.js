import { afterEach, describe, expect, it, vi } from "vitest";
import { handleFetchCore, parseContext7LibraryId } from "open-sse/handlers/fetch/index.js";
import { normalizeSearchResponse } from "open-sse/handlers/search/normalizers.js";
import { isValidContext7LibraryId } from "open-sse/shared/context7LibraryId.js";

/**
 * Context7 library references (OmniRoute #20839, merged as
 * b748429cf5b3aeb142a708fd3e8751b6918b9dc8).
 *
 * The fetch executor and the search normalizer must accept the same library
 * ids: exactly two path-safe segments ("/owner/repo"), each starting with an
 * alphanumeric character, with single interior dots allowed.
 */

const CONTEXT7_FETCH_CONFIG = {
  formats: ["markdown"],
  timeoutMs: 15000,
  costPerQuery: 0,
};

const originalFetch = globalThis.fetch;

function context7Fetch(url, credentials = {}) {
  return handleFetchCore({
    url,
    provider: "context7",
    providerConfig: CONTEXT7_FETCH_CONFIG,
    credentials,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Context7 library reference grammar", () => {
  it.each([
    ["https://context7.com/reactjs/react.dev", "/reactjs/react.dev"],
    ["http://context7.com/reactjs/react.dev", "/reactjs/react.dev"],
    ["https://www.context7.com/reactjs/react.dev", "/reactjs/react.dev"],
    ["www.context7.com/reactjs/react.dev", "/reactjs/react.dev"],
    ["context7.com/reactjs/react.dev", "/reactjs/react.dev"],
    ["/reactjs/react.dev", "/reactjs/react.dev"],
    ["reactjs/react.dev", "/reactjs/react.dev"],
    ["reactjs/react.dev/", "/reactjs/react.dev"],
    ["https://context7.com/vercel/next.js/", "/vercel/next.js"],
    ["/some-org/some_repo", "/some-org/some_repo"],
    ["/facebook/react", "/facebook/react"],
    ["/owner-name/repo-name.2", "/owner-name/repo-name.2"],
    ["  /reactjs/react.dev  ", "/reactjs/react.dev"],
  ])("parses %s into the canonical id %s", (input, expected) => {
    expect(parseContext7LibraryId(input)).toBe(expected);
  });

  it.each([
    ["/owner/.."],
    ["/owner/."],
    ["/owner/../evil"],
    ["/../evil/x"],
    ["/owner/repo/extra"],
    ["/owner//repo"],
    ["/owner/repo//"],
    ["/only-one"],
    ["/owner"],
    ["/-owner/repo"],
    ["/owner/-repo"],
    ["/.owner/repo"],
    ["/owner/repo."],
    ["/foo..bar/baz"],
    ["/foo/bar..baz"],
    ["https://example.com/owner/repo"],
    ["https://context7.com.evil.test/owner/repo"],
    ["ftp://context7.com/owner/repo"],
    ["/owner/repo?type=txt"],
    ["/owner/repo#frag"],
    [""],
    ["/"],
    ["owner"],
  ])("rejects %s", (input) => {
    expect(parseContext7LibraryId(input)).toBeNull();
  });

  it.each([[null], [undefined], [42], [{}], [[]]])("rejects the non-string input %s", (input) => {
    expect(parseContext7LibraryId(input)).toBeNull();
  });

  it("keeps the fetch parser and the search normalizer on one grammar", () => {
    const candidates = [
      "/reactjs/react.dev",
      "/vercel/next.js",
      "/some-org/some_repo",
      "/owner/..",
      "/-owner/repo",
      "/owner/repo/extra",
      "/foo..bar/baz",
      "/owner/repo.",
      "/only-one",
    ];
    const normalized = normalizeSearchResponse(
      "context7",
      { results: candidates.map((id) => ({ id, title: id, description: "" })) },
      "react",
      "web"
    );
    const published = normalized.results.map((result) => result.url.replace("https://context7.com", ""));
    const acceptedByFetch = candidates.filter((id) => parseContext7LibraryId(id) === id);

    expect(published).toEqual(acceptedByFetch);
    expect(published.every((id) => isValidContext7LibraryId(id))).toBe(true);
    expect(published).toEqual(["/reactjs/react.dev", "/vercel/next.js", "/some-org/some_repo"]);
  });

  it("rejects an out-of-grammar reference before contacting Context7", async () => {
    globalThis.fetch = vi.fn();

    const result = await context7Fetch("https://context7.com/owner/..");

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("Context7 fetch expects a library reference");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps the endpoint construction and the optional bearer credential unchanged", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "# Context7 docs",
    });

    const result = await context7Fetch("https://context7.com/reactjs/react.dev", { apiKey: "ctx7sk-test" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = globalThis.fetch.mock.calls[0];
    expect(calledUrl).toBe("https://context7.com/api/v1/reactjs/react.dev?type=llms.txt");
    expect(init.headers.Authorization).toBe("Bearer ctx7sk-test");
    expect(result.success).toBe(true);
    expect(result.data.url).toBe("https://context7.com/reactjs/react.dev");
  });

  it("sends no Authorization header when no key is configured", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "# Context7 docs",
    });

    const result = await context7Fetch("https://context7.com/reactjs/react.dev");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
