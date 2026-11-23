import { describe, expect, it } from "vitest";

import { __buildImageDownloadHeadersForTesting } from "../../open-sse/executors/chatgpt-web-http.js";
import { sanitizeErrorMessage } from "../../open-sse/executors/websession-utils.js";

const ctx = {
  accessToken: "bearer-secret",
  cookie: "session-secret",
  accountId: "account-secret",
};

describe("ChatGPT image download credentials", () => {
  it("keeps ChatGPT credentials on HTTPS ChatGPT hosts", () => {
    const headers = __buildImageDownloadHeadersForTesting("https://estuary.chatgpt.com/image", ctx);

    expect(headers.Authorization).toBe("Bearer bearer-secret");
    expect(headers.Cookie).toContain("session-secret");
    expect(headers["chatgpt-account-id"]).toBe("account-secret");
  });

  it("omits credentials for a signed URL on another HTTPS host", () => {
    const headers = __buildImageDownloadHeadersForTesting("https://files.oaiusercontent.com/image", ctx);

    expect(headers).not.toHaveProperty("Authorization");
    expect(headers).not.toHaveProperty("Cookie");
    expect(headers).not.toHaveProperty("chatgpt-account-id");
  });

  it("rejects non-HTTPS download URLs", () => {
    expect(__buildImageDownloadHeadersForTesting("http://chatgpt.com/image", ctx)).toBeNull();
    expect(__buildImageDownloadHeadersForTesting("javascript:alert(1)", ctx)).toBeNull();
  });
});

describe("web session error cookie redaction", () => {
  it.each([
    ["Cookie: sso=SECRET; other=1", "Cookie: [redacted]"],
    ["__Secure-next-auth.session-token=ABC", "__Secure-next-auth.session-token=[redacted]"],
    ["cookie=XYZ", "cookie=[redacted]"],
  ])("redacts %s", (input, expected) => {
    expect(sanitizeErrorMessage(input)).toBe(expected);
  });
});
