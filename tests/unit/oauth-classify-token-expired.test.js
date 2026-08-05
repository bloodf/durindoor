import { describe, expect, it } from "vitest";
import { classifyOAuthRefreshError } from "../../open-sse/services/tokenRefresh/providers.js";

describe("classifyOAuthRefreshError (#1821)", () => {
  it("marks OpenAI 401 token_expired as permanent", () => {
    const body = JSON.stringify({ error: { code: "token_expired", type: "invalid_request_error" } });
    expect(classifyOAuthRefreshError(body, 401)).toMatchObject({ status: 401, permanent: true });
  });

  it("marks the human-readable OpenAI marker as permanent", () => {
    expect(classifyOAuthRefreshError("could not validate your token", 401)).toMatchObject({ permanent: true });
  });

  it("keeps transient 429 refresh attempts retryable", () => {
    expect(classifyOAuthRefreshError("rate limit", 429)).toMatchObject({ permanent: false });
  });
});
