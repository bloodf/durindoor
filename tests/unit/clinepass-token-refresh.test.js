/**
 * Upstream f6e7cabe — ClinePass must be refreshable on the proactive service path.
 *
 * `refreshTokenByProvider` previously had no `cline`/`clinepass` handler, so it
 * fell through to the generic form-encoded OAuth grant that api.cline.bot
 * rejects — expired ClinePass tokens were never rotated and every request kept
 * 401ing. These tests pin the Cline JSON wire contract and the handler wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";

const REFRESH_URL = "https://api.cline.bot/api/v1/auth/refresh";
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1XzEifQ.sig";

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clinepass token refresh", () => {
  it("posts the Cline JSON grant rather than a form-encoded OAuth body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { accessToken: JWT, refreshToken: "rt-new", expiresAt: new Date(Date.now() + 3600_000).toISOString() } })
    );

    const result = await refreshTokenByProvider("clinepass", { refreshToken: "rt-a" }, null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(REFRESH_URL);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      refreshToken: "rt-a",
      grantType: "refresh_token",
      clientType: "extension"
    });

    // The rotated JWT must come back wire-ready (workos:-prefixed) so callers
    // can store it verbatim.
    expect(result.accessToken).toBe(`workos:${JWT}`);
    expect(result.refreshToken).toBe("rt-new");
    expect(result.expiresIn).toBeGreaterThan(0);
  });

  it("accepts a top-level (unenveloped) payload and keeps the old refresh token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: JWT }));
    const result = await refreshTokenByProvider("cline", { refreshToken: "rt-b" }, null);

    expect(result.accessToken).toBe(`workos:${JWT}`);
    expect(result.refreshToken).toBe("rt-b");
    expect(result.expiresIn).toBeUndefined();
  });

  it("returns null on an upstream failure instead of a tokenless credential", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "invalid_grant" }, false, 401));

    expect(await refreshTokenByProvider("clinepass", { refreshToken: "rt-c" }, null)).toBeNull();
  });

  it("does not call the network without a refresh token", async () => {
    expect(await refreshTokenByProvider("clinepass", {}, null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
