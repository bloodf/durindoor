import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFetchCore } from "open-sse/handlers/fetch/index.js";
import {
  assertGuardedProbeDispatcherAddressAllowed,
  OutboundUrlGuardError,
} from "open-sse/utils/outboundUrlGuard.js";

const originalFetch = globalThis.fetch;

function tavilyFetch(url) {
  return handleFetchCore({
    url,
    provider: "tavily",
    credentials: { apiKey: "test-key" },
  });
}

describe("web fetch SSRF boundaries (9router #3497, issue #607)", () => {
  beforeEach(() => {
    delete process.env.OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS;
    delete process.env.OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS;
  });

  afterEach(() => {
    delete process.env.OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS;
    delete process.env.OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://127.0.0.1:3000/api/settings/database",
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "file:///etc/passwd",
    "https://user:password@example.com/",
  ])("rejects malicious target %s before contacting a fetch provider", async (url) => {
    globalThis.fetch = vi.fn();

    const result = await tavilyFetch(url);

    expect(result.success).toBe(false);
    expect([400, 403]).toContain(result.status);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("routes the provider request through the DNS-pinned, manual-redirect guard", async () => {
    process.env.OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS = "false";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ results: [{ raw_content: "safe" }] }),
    });

    const result = await tavilyFetch("https://example.com/article");

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.redirect).toBe("manual");
    expect(init.dispatcher).toBeDefined();
    expect(() =>
      assertGuardedProbeDispatcherAddressAllowed(init.dispatcher, "127.0.0.1")
    ).toThrow(OutboundUrlGuardError);
    expect(() =>
      assertGuardedProbeDispatcherAddressAllowed(init.dispatcher, "169.254.169.254")
    ).toThrow(OutboundUrlGuardError);
  });
});
