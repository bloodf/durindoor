import { afterEach, describe, expect, it, vi } from "vitest";
import {
  maskSensitiveHeaders,
  maskSensitiveText,
  maskSensitiveUrl,
} from "../../open-sse/utils/requestLogger.js";
import { sanitizeErrorMessage } from "../../open-sse/utils/error.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.ENABLE_REQUEST_LOGS;
  vi.resetModules();
});

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

  it("redacts OAuth callback values and proxy URL credentials", () => {
    const message = sanitizeErrorMessage(
      "exchange failed https://alice:proxy-pass@proxy.example:8443/callback?code=oauth-code&state=oauth-state",
    );

    expect(message).not.toContain("alice");
    expect(message).not.toContain("proxy-pass");
    expect(message).not.toContain("oauth-code");
    expect(message).not.toContain("oauth-state");
    expect(message).toContain("https://[redacted]@proxy.example:8443");
    expect(message).toContain("code=[redacted]");
    expect(message).toContain("state=[redacted]");
  });
});

describe("request logger metadata-only persistence", () => {
  it("writes bounded metadata without any stage, stream, error, or legacy payload content", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-request-log-"));
    process.chdir(temp);
    process.env.ENABLE_REQUEST_LOGS = "true";
    vi.resetModules();
    const loggerModule = await import("../../open-sse/utils/requestLogger.js");
    const logger = await loggerModule.createRequestLogger("openai", "claude", "model-test");
    const canaries = {
      client: "CLIENT-PROMPT-CANARY",
      normalized: "NORMALIZED-CANARY",
      intermediate: "INTERMEDIATE-SOURCE-CANARY",
      target: "TRANSLATED-PROVIDER-CANARY",
      provider: "PROVIDER-RESPONSE-CANARY",
      converted: "CONVERTED-CLIENT-CANARY",
      providerChunk: "PROVIDER-CHUNK-CANARY",
      openaiChunk: "OPENAI-CHUNK-CANARY",
      convertedChunk: "CLIENT-CHUNK-CANARY",
      binaryChunk: "BINARY-CHUNK-CANARY",
      error: "ERROR-MESSAGE-CANARY",
      stack: "STACK-CANARY",
      requestBody: "ERROR-REQUEST-BODY-CANARY",
      source: "function confidentialSource() {}",
    };

    try {
      logger.logClientRawRequest("https://user:url-pass@example.test/chat?token=query-secret#access_token=fragment-secret", { prompt: canaries.client, source: canaries.source }, { authorization: "Bearer header-secret" });
      logger.logRawRequest({ prompt: canaries.normalized });
      logger.logOpenAIRequest({ input: canaries.intermediate });
      logger.logTargetRequest("https://example.test/v1?api_key=target-secret", { cookie: "cookie-secret" }, { input: canaries.target });
      logger.logProviderResponse(200, "OK", { "content-type": "application/json" }, { output: canaries.provider });
      logger.appendProviderChunk(canaries.providerChunk);
      logger.appendProviderChunk(new TextEncoder().encode(canaries.binaryChunk));
      logger.appendOpenAIChunk(new Uint8Array());
      logger.logConvertedResponse({ output: canaries.converted });
      logger.appendConvertedChunk(canaries.convertedChunk);
      const error = new Error(canaries.error);
      error.stack = `${canaries.error}\n    at ${canaries.stack}`;
      logger.logError(error, { prompt: canaries.requestBody });
      loggerModule.logError("openai", {
        error,
        url: "https://user:legacy-pass@example.test/chat?token=legacy-query-secret",
        model: "model-test",
        requestBody: { prompt: canaries.requestBody },
      });

      const files = [
        ...fs.readdirSync(logger.sessionPath).map((name) => path.join(logger.sessionPath, name)),
        ...fs.readdirSync(path.join(temp, "logs"))
          .filter((name) => name.endsWith(".log"))
          .map((name) => path.join(temp, "logs", name)),
      ];
      const output = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

      for (const canary of Object.values(canaries)) expect(output).not.toContain(canary);
      expect(output).not.toMatch(/header-secret|url-pass|query-secret|fragment-secret|target-secret|cookie-secret|legacy-pass/);
      expect(output).not.toContain("stack");

      const clientMetadata = JSON.parse(fs.readFileSync(path.join(logger.sessionPath, "1_req_client.json"), "utf8"));
      expect(clientMetadata.body).toEqual({ redacted: true, present: true, type: "object", bytes: Buffer.byteLength(JSON.stringify({ prompt: canaries.client, source: canaries.source })) });
      const providerStream = JSON.parse(fs.readFileSync(path.join(logger.sessionPath, "5_res_provider.txt"), "utf8"));
      expect(providerStream.body).toEqual({ redacted: true, present: true, type: "bytes", bytes: Buffer.byteLength(canaries.providerChunk) + Buffer.byteLength(canaries.binaryChunk) });
      expect(providerStream.chunks).toBe(2);
      const openAIStream = JSON.parse(fs.readFileSync(path.join(logger.sessionPath, "6_res_openai.txt"), "utf8"));
      expect(openAIStream.body).toEqual({ redacted: true, present: true, type: "bytes", bytes: 0 });
      expect(openAIStream.chunks).toBe(1);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
