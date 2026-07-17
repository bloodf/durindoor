import { describe, expect, it } from "vitest";

import { getErrorMessage } from "../../src/lib/network/proxyTest.js";

describe("proxy validation error redaction", () => {
  it("keeps transport diagnostics without exposing proxy or OAuth credentials", () => {
    const message = getErrorMessage({
      message: "proxy connect failed for http://alice:proxy-secret@proxy.example.test:8080?token=query-secret",
      cause: {
        code: "ECONNREFUSED",
        message: 'upstream {"refresh_token":"refresh-secret","authorization":"Bearer bearer-secret"}',
      },
    });

    expect(message).toContain("ECONNREFUSED");
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("proxy-secret");
    expect(message).not.toContain("query-secret");
    expect(message).not.toContain("refresh-secret");
    expect(message).not.toContain("bearer-secret");
  });

  it("preserves ordinary actionable transport errors", () => {
    expect(getErrorMessage({
      message: "fetch failed",
      cause: { code: "ECONNREFUSED", message: "Connection refused" },
    })).toBe("fetch failed: Connection refused (ECONNREFUSED)");
  });
});
