import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import firecrawl from "../../open-sse/providers/registry/firecrawl.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";

describe("9router #5888 Firecrawl v2 scrape formats", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("publishes the v2 scrape URL and only markdown/html formats in the registry", () => {
    expect(firecrawl.fetchConfig.baseUrl).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(firecrawl.fetchConfig.formats).toEqual(["markdown", "html"]);
  });

  it.each([
    [undefined, "markdown", "# Hello"],
    ["markdown", "markdown", "# Hello"],
    ["html", "html", "<p>Hello</p>"],
  ])("calls Firecrawl v2 and returns the requested %s format even when both fields are present", async (format, requestedFormat, expectedText) => {
    globalThis.fetch.mockResolvedValueOnce(Response.json({
      success: true,
      data: {
        markdown: "# Hello",
        html: "<p>Hello</p>",
        metadata: { title: "Hello" },
      },
    }));

    const result = await handleFetchCore({
      url: "https://example.com",
      format,
      provider: "firecrawl",
      providerConfig: {},
      credentials: { apiKey: "fc-test-key" },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [endpoint, request] = globalThis.fetch.mock.calls[0];
    expect(endpoint).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(request.method).toBe("POST");
    expect(request.headers.authorization).toBe("Bearer fc-test-key");
    expect(JSON.parse(request.body)).toEqual({ url: "https://example.com", formats: [requestedFormat] });
    expect(result).toMatchObject({
      success: true,
      data: {
        title: "Hello",
        content: { format: requestedFormat, text: expectedText, length: expectedText.length },
      },
    });
  });

  it("rejects Firecrawl's unsupported text format locally without calling upstream", async () => {
    const result = await handleFetchCore({
      url: "https://example.com",
      format: "text",
      provider: "firecrawl",
      providerConfig: {},
      credentials: { apiKey: "fc-test-key" },
    });

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
