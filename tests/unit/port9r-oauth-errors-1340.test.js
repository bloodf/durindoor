import { describe, expect, it } from "vitest";
import { oauthResponseError, parseOAuthResponse } from "../../src/shared/utils/oauthResponse.js";

describe("OAuth response errors", () => {
  it("preserves a non-JSON proxy error", async () => {
    const response = new Response("Service unavailable", { status: 503 });
    const data = await parseOAuthResponse(response);
    expect(oauthResponseError(response, data)).toBe("Service unavailable");
  });

  it("preserves OAuth polling errors and provides a status fallback", async () => {
    const pending = new Response('{"error":"authorization_pending"}', { status: 400 });
    expect(await parseOAuthResponse(pending)).toEqual({ error: "authorization_pending" });
    const empty = new Response("", { status: 502 });
    expect(oauthResponseError(empty, await parseOAuthResponse(empty))).toBe("Authentication failed (502)");
  });
});
