/**
 * A credential whose `expiresAt` is a numeric epoch *string* must still drive the
 * proactive OAuth refresh.
 *
 * `parseTimeMs()` handled `number` and date-like strings, but
 * `new Date("1789012345678")` is an Invalid Date, so a numeric string returned
 * `null`. With a null expiry `shouldRefreshCredentials()` returns false, the
 * on-request refresh never fires, and the connection keeps an expired access
 * token until the user re-authenticates by hand.
 *
 * The shape is reachable: both OAuth bulk-import routes persist the user-supplied
 * value verbatim —
 *   src/app/api/oauth/grok-cli/bulk-import/route.js:79 (`expires_at`/`expiresAt`)
 *   src/app/api/oauth/codex/bulk-import/route.js:110   (`item.expiresAt`)
 * — and only synthesize an ISO string when the field is absent.
 */
import { describe, it, expect } from "vitest";
import {
  getCredentialExpiryMs,
  shouldRefreshCredentials,
} from "../../open-sse/services/oauthCredentialManager.js";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

describe("numeric-epoch expiresAt", () => {
  it("parses epoch milliseconds given as a string", () => {
    const ms = NOW + 10 * 60 * 1000;
    expect(getCredentialExpiryMs({ expiresAt: String(ms) })).toBe(ms);
  });

  it("parses epoch seconds given as a string", () => {
    const seconds = Math.floor((NOW + 10 * 60 * 1000) / 1000);
    expect(getCredentialExpiryMs({ expiresAt: String(seconds) })).toBe(seconds * 1000);
  });

  it("still parses the number and ISO forms", () => {
    const ms = NOW + 10 * 60 * 1000;
    expect(getCredentialExpiryMs({ expiresAt: ms })).toBe(ms);
    expect(getCredentialExpiryMs({ expiresAt: new Date(ms).toISOString() })).toBe(ms);
  });

  it("refuses a non-numeric, non-date string rather than coercing it", () => {
    expect(getCredentialExpiryMs({ expiresAt: "not-a-time" })).toBeNull();
    expect(getCredentialExpiryMs({ expiresAt: "" })).toBeNull();
    expect(getCredentialExpiryMs({})).toBeNull();
  });

  it("refreshes a string-epoch credential that is inside the expiry buffer", () => {
    const credentials = {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: String(NOW + 30 * 1000),
    };
    expect(shouldRefreshCredentials("codex", credentials, NOW)).toBe(true);
  });

  it("leaves a string-epoch credential alone while it is still fresh", () => {
    const credentials = {
      accessToken: "at",
      refreshToken: "rt",
      // Codex refreshes 120h ahead of expiry, so "fresh" has to clear that window.
      expiresAt: String(NOW + 200 * 60 * 60 * 1000),
      // Codex also refreshes proactively on refresh-token age; pin a recent refresh
      // so this case exercises the expiry path only.
      lastRefreshAt: new Date(NOW - 60 * 1000).toISOString(),
    };
    expect(shouldRefreshCredentials("codex", credentials, NOW)).toBe(false);
  });
});
