// Trust boundary for dedicated search endpoints (upstream #3714 + #3793):
// an administrator-configured provider baseUrl may intentionally point at a
// private service (a SearXNG container, a loopback listener) and must work,
// while a client-supplied provider_options.baseUrl override stays behind the
// SSRF guard. Written against handleSearchCore so the whole dispatch path —
// request build, guard decision, fetch, normalization — is exercised.
import http from "node:http";
import { describe, it, expect } from "vitest";
import { resolveBaseUrl } from "../../open-sse/handlers/search/callers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";

const CONFIG = { id: "searxng", baseUrl: "https://searxng.example.com" };

describe("resolveBaseUrl SSRF guard", () => {
  it("trusts the administrator-configured provider default", () => {
    expect(resolveBaseUrl(CONFIG, { query: "q" })).toBe("https://searxng.example.com");
  });

  it("rejects a client-supplied private baseUrl override", () => {
    expect(() =>
      resolveBaseUrl(CONFIG, { query: "q", providerOptions: { baseUrl: "http://127.0.0.1:8080" } })
    ).toThrow(/Blocked/);
    expect(() =>
      resolveBaseUrl(CONFIG, { query: "q", providerOptions: { baseUrl: "http://169.254.169.254/latest" } })
    ).toThrow(/Blocked/);
  });

  it("allows a client-supplied public baseUrl override", () => {
    expect(resolveBaseUrl(CONFIG, { query: "q", providerOptions: { baseUrl: "https://searxng.example.org/" } }))
      .toBe("https://searxng.example.org");
  });
});

describe("search endpoint trust boundary", () => {
  it("allows an admin-configured SearXNG endpoint on the private network", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        results: [{ title: "Internal result", url: "https://example.com", content: "ok" }],
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      const result = await handleSearchCore({
        body: { query: "test" },
        provider: { id: "searxng" },
        providerConfig: { authType: "none", baseUrl: `http://127.0.0.1:${address.port}` },
        credentials: null,
      });

      expect(result.success, result.error).toBe(true);
      expect(result.data.results[0]).toEqual(expect.objectContaining({
        title: "Internal result",
        url: "https://example.com",
      }));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("still rejects a client-supplied private baseUrl override", async () => {
    const result = await handleSearchCore({
      body: {
        query: "test",
        provider_options: { baseUrl: "http://127.0.0.1:18999" },
      },
      provider: { id: "searxng" },
      providerConfig: { authType: "none", baseUrl: "https://searxng.example.com" },
      credentials: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Blocked/);
  });
});
