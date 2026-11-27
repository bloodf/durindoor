import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import firecrawl from "../../open-sse/providers/registry/firecrawl.js";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("Firecrawl v2 scrape formats (upstream #5888)", () => {
  it.each([
    [undefined, "markdown", "# Hello"],
    ["html", "html", "<p>Hello</p>"],
  ])("posts to Firecrawl v2 and returns requested %s content", async (format, requestedFormat, content) => {
    fetch.mockResolvedValue(Response.json({
      success: true,
      data: { markdown: "# Hello", html: "<p>Hello</p>", metadata: { title: "Hello" } },
    }));

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "firecrawl",
      format,
      providerConfig: firecrawl.fetchConfig,
      credentials: { apiKey: "test-key" },
    });
    const [endpoint, request] = fetch.mock.calls[0];
    expect(endpoint).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(request.method).toBe("POST");
    expect(request.headers.authorization).toBe("Bearer test-key");
    expect(JSON.parse(request.body)).toEqual({ url: "https://example.com", formats: [requestedFormat] });
    expect(result).toMatchObject({
      success: true,
      data: { title: "Hello", content: { format: requestedFormat, text: content, length: content.length } },
    });
  });

  it("rejects Firecrawl's unsupported text format locally even without providerConfig formats", async () => {
    expect(await handleFetchCore({
      url: "https://example.com",
      provider: "firecrawl",
      format: "text",
      providerConfig: firecrawl.fetchConfig,
      credentials: { apiKey: "test-key" },
    })).toMatchObject({ success: false, status: 400 });
    expect(await handleFetchCore({
      url: "https://example.com",
      provider: "firecrawl",
      format: "text",
      providerConfig: {},
      credentials: { apiKey: "test-key" },
    })).toMatchObject({ success: false, status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
