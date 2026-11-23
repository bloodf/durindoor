import { describe, expect, it, vi } from "vitest";

const originalImageFetcher = vi.hoisted(() => ({ fetch: null }));
vi.mock("../../open-sse/translator/concerns/image.js", async (importOriginal) => {
  const actual = await importOriginal();
  originalImageFetcher.fetch = actual.fetchImageAsBase64;
  return { ...actual, fetchImageAsBase64: vi.fn(async (_url, options) => ({
    url: `data:image/png;base64,${"A".repeat(Math.min(8, options.maxBytes ?? 8))}`,
    mimeType: "image/png",
  })) };
});

import { prefetchRemoteImages } from "../../open-sse/translator/concerns/prefetch.js";
import { fetchImageAsBase64 } from "../../open-sse/translator/concerns/image.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { isBlockedHost } from "../../src/shared/utils/ssrfGuard.js";
import { assertOutboundUrlAllowed } from "../../open-sse/utils/outboundUrlGuard.js";

describe("image prefetch and transition-address regressions (#2236, #2240)", () => {
  it("blocks special-purpose IPv4 and IPv6 in the shared classifier", () => {
    for (const host of ["192.0.2.1", "2001:db8::1"]) expect(isBlockedHost(host)).toBe(true);
  });

  it("caps the number of remote images fetched per request", async () => {
    const content = Array.from({ length: 12 }, (_, i) => ({ type: "image_url", image_url: { url: `https://example.test/${i}.png` } }));
    await prefetchRemoteImages({ messages: [{ content }] }, FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(fetchImageAsBase64).toHaveBeenCalledTimes(10);
  });

  it("passes the remaining request byte budget to subsequent image fetches", async () => {
    const content = Array.from({ length: 3 }, (_, i) => ({ type: "image_url", image_url: { url: `https://example.test/${i}.png` } }));
    await prefetchRemoteImages({ messages: [{ content }] }, FORMATS.OPENAI, FORMATS.OLLAMA);
    const budget = fetchImageAsBase64.mock.calls[1][1].maxBytes;
    expect(budget).toBeLessThan(10 * 1024 * 1024);
  });

  it("keeps the timeout active when a caller signal is supplied", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    try {
      const caller = new AbortController();
      await expect(originalImageFetcher.fetch("http://8.8.8.8/image.png", { signal: caller.signal, timeoutMs: 20 })).resolves.toBeNull();
      expect(caller.signal.aborted).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    ["block-metadata", "http://[64:ff9b::a9fe:a9fe]/"],
    ["public-only", "http://[2002:a9fe:a9fe::]/"],
    ["public-only", "http://[2002:7f00:1::]/"],
    ["public-only", "http://[2001:0:0808:0808:0:0:f5ff:ffff]/"],
  ])("blocks embedded private addresses for %s: %s", (mode, url) => {
    expect(() => assertOutboundUrlAllowed(url, mode)).toThrow();
  });
});
