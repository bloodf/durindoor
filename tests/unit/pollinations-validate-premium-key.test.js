/**
 * Unit tests for the Pollinations no-auth + premium-key path in
 * POST /api/providers/validate (src/app/api/providers/validate/route.js,
 * `default` case).
 *
 * Regression coverage for: Pollinations is configured `noAuth: true` because
 * its base catalog is free/keyless, but it also advertises
 * `authModes: ["apikey"]` for premium models (see
 * open-sse/providers/registry/pollinations.js). The old `if (cfg.noAuth)`
 * short-circuit returned `valid: true` for ANY request — including one that
 * supplied a real (or mistyped) premium key — without ever probing it, so a
 * bad key was saved as "valid" and only failed later at request time. The
 * fix only short-circuits when the caller genuinely omitted a key
 * (`cfg.noAuth && !apiKey`); a supplied key still falls through to the real
 * Bearer probe against the /models endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/models", () => ({
  getProviderNodeById: vi.fn(),
}));

import { POST } from "../../src/app/api/providers/validate/route.js";

const originalFetch = global.fetch;

function postRequest(body) {
  return new Request("http://localhost/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/providers/validate - Pollinations no-auth + premium key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns valid:true without probing when no API key is supplied (keyless catalog)", async () => {
    global.fetch = vi.fn();

    const res = await POST(postRequest({ provider: "pollinations" }));
    const data = await res.json();

    expect(data).toEqual({ valid: true, error: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls through to the real Bearer probe when a premium key is supplied", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const res = await POST(postRequest({ provider: "pollinations", apiKey: "real-premium-key" }));
    const data = await res.json();

    expect(global.fetch).toHaveBeenCalled();
    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain("pollinations");
    expect(options.headers.Authorization).toBe("Bearer real-premium-key");
    expect(data).toEqual({ valid: true, error: null });
  });

  it.each([401, 403])(
    "returns valid:false when the probe rejects the supplied key with %d",
    async (status) => {
      global.fetch = vi.fn().mockResolvedValue(new Response("", { status }));

      const res = await POST(postRequest({ provider: "pollinations", apiKey: "bad-premium-key" }));
      const data = await res.json();

      expect(data.valid).toBe(false);
      expect(data.error).toBeTruthy();
    },
  );
});
