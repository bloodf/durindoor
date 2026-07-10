import { describe, expect, it } from "vitest";
import {
  maskSensitiveHeaders,
  maskSensitiveText,
  maskSensitiveUrl,
  maskSensitiveValue,
} from "../../open-sse/utils/requestLogger.js";
import { sanitizeErrorMessage } from "../../open-sse/utils/error.js";

describe("request logger credential redaction", () => {
  it("redacts secret header values while retaining diagnostic headers", () => {
    expect(maskSensitiveHeaders({
      Authorization: "Bearer secret-token",
      Cookie: "session=secret",
      "x-api-key": "secret-key",
      HAIPER_KEY: "haiper-secret",
      key: "raw-key-secret",
      "X-Model-Key": "model-key-secret",
      session_id: "conversation-secret",
      "ChatGPT-Account-ID": "account-secret",
      "prompt-cache-key": "cache-secret",
      "x-request-id": "request-123",
      Accept: "application/json",
    })).toEqual({
      Authorization: "[redacted]",
      Cookie: "[redacted]",
      "x-api-key": "[redacted]",
      HAIPER_KEY: "[redacted]",
      key: "[redacted]",
      "X-Model-Key": "[redacted]",
      session_id: "[redacted]",
      "ChatGPT-Account-ID": "[redacted]",
      "prompt-cache-key": "[redacted]",
      "x-request-id": "request-123",
      Accept: "application/json",
    });
  });

  it("supports Headers objects and redacts response cookies", () => {
    const headers = new Headers({
      "set-cookie": "session=secret",
      "content-type": "application/json",
    });

    expect(maskSensitiveHeaders(headers)).toEqual({
      "content-type": "application/json",
      "set-cookie": "[redacted]",
    });
  });

  it("redacts sensitive query parameters without hiding ordinary routing data", () => {
    const masked = maskSensitiveUrl(
      "https://zenmux.ai/api/messages?ctoken=secret&model=deepseek%2Fchat&sig=abc&session_id=private-session",
    );

    expect(masked).toContain("ctoken=%5Bredacted%5D");
    expect(masked).toContain("model=deepseek%2Fchat");
    expect(masked).toContain("sig=%5Bredacted%5D");
    expect(masked).toContain("session_id=%5Bredacted%5D");
    expect(masked).not.toContain("secret");
  });

  it("redacts URL userinfo and credential-shaped diagnostic text", () => {
    expect(maskSensitiveUrl("https://user:password@example.test/path")).not.toContain("password");
    expect(maskSensitiveUrl("https://example.test/cb#access_token=fragment-secret&state=ok"))
      .toBe("https://example.test/cb#access_token=%5Bredacted%5D&state=ok");
    expect(maskSensitiveText(
      "request failed for https://example.test?access_token=secret; Cookie: session=also-secret",
    )).toBe(
      "request failed for https://example.test?access_token=[redacted]; Cookie: [redacted]",
    );
    expect(maskSensitiveText(
      'data: {"access_token":"SECRET123","cookie":"session=SECRET","key":"KEY","safe":"ok"}',
    )).toBe(
      'data: {"access_token":"[redacted]","cookie":"[redacted]","key":"[redacted]","safe":"ok"}',
    );
    expect(maskSensitiveText(
      "X-Subscription-Token: subscription-secret\nClient-Secret: client-secret",
    )).toBe(
      "X-Subscription-Token: [redacted]\nClient-Secret: [redacted]",
    );
    expect(maskSensitiveText(
      "session_id: private-session\nChatGPT-Account-ID: private-account\nprompt_cache_key: private-cache",
    )).toBe(
      "session_id: [redacted]\nChatGPT-Account-ID: [redacted]\nprompt_cache_key: [redacted]",
    );
    expect(maskSensitiveText("request failed?session_id=private-session&model=gpt"))
      .toBe("request failed?session_id=[redacted]&model=gpt");
  });

  it("recursively redacts response and request body credential fields", () => {
    expect(maskSensitiveValue({
      error: "request failed?ctoken=secret",
      nested: {
        accessToken: "secret-token",
        refresh_token: "refresh-secret",
        api_key: "api-secret",
        auth: "auth-secret",
        "x-api-key": "x-api-secret",
        session_id: "private-session",
        prompt_cache_key: "private-cache",
        safe: "model-1",
      },
      rows: [{ cookie: "session=secret", "set-cookie": "server-secret" }],
    })).toEqual({
      error: "request failed?ctoken=[redacted]",
      nested: {
        accessToken: "[redacted]",
        refresh_token: "[redacted]",
        api_key: "[redacted]",
        auth: "[redacted]",
        "x-api-key": "[redacted]",
        session_id: "[redacted]",
        prompt_cache_key: "[redacted]",
        safe: "model-1",
      },
      rows: [{ cookie: "[redacted]", "set-cookie": "[redacted]" }],
    });
  });

  it("redacts credentials embedded in transport error messages", () => {
    const message = sanitizeErrorMessage(
      "request https://example.test/chat?ctoken=secret&model=x failed; X-Model-Key: model-secret",
    );

    expect(message).toContain("ctoken=[redacted]");
    expect(message).toContain("X-Model-Key: [redacted]");
    expect(message).not.toContain("secret");
    expect(sanitizeErrorMessage('{"client_secret":"json-secret"}')).toBe(
      '{"client_secret":"[redacted]"}',
    );
    expect(sanitizeErrorMessage("X-Subscription-Token: header-secret")).toBe(
      "X-Subscription-Token: [redacted]",
    );
  });
});
