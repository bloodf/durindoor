import { describe, expect, it } from "vitest";
import { classifyOAuthRefreshError } from "../../open-sse/services/tokenRefresh/providers.js";

describe("classifyOAuthRefreshError (#1821)", () => {
  it("marks any 401 response as permanent", () => {
    expect(classifyOAuthRefreshError("upstream rejected credentials", 401)).toMatchObject({
      status: 401,
      permanent: true,
    });
  });

  it("marks token_expired as permanent without a 401", () => {
    const body = JSON.stringify({ error: { code: "token_expired", type: "invalid_request_error" } });
    expect(classifyOAuthRefreshError(body, 400)).toMatchObject({ status: 400, permanent: true });
  });

  it("marks the human-readable token marker as permanent without a 401", () => {
    expect(classifyOAuthRefreshError("could not validate your token", 403)).toMatchObject({
      status: 403,
      permanent: true,
    });
  });

  it("keeps unrelated 429 responses retryable", () => {
    expect(classifyOAuthRefreshError("rate limit", 429)).toMatchObject({ permanent: false });
  });

  it("keeps ordinary 400 responses retryable", () => {
    expect(classifyOAuthRefreshError("invalid request parameters", 400)).toMatchObject({ permanent: false });
  });
});
