import { describe, expect, it, vi } from "vitest";
import {
  handleNonStreamingResponse,
  isHtmlErrorPageBody,
} from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const HTML_MESSAGE =
  "Provider returned HTML error page instead of JSON - check credentials and endpoint";

const HTML_DOCTYPE_PAGE =
  "<!DOCTYPE html>\n<html><head><title>502 Bad Gateway</title></head>" +
  "<body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>";

const HTML_CAPTIVE_PAGE =
  "<html><body>Sign in to the guest network to continue</body></html>";

const XML_ERROR_PAGE = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code></Error>';

function makeProviderResponse(text, contentType = "text/html") {
  return {
    headers: new Map([["content-type", contentType]]),
    text: () => Promise.resolve(text),
    status: 200,
    statusText: "OK",
  };
}

function options(providerResponse, provider = "galadriel") {
  return {
    providerResponse,
    provider,
    model: "galadriel-latest",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { model: "galadriel-latest", messages: [] },
    stream: false,
    streamToClient: false,
    requestStartTime: Date.now(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    toolNameMap: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  };
}

/**
 * OmniRoute #1104 (head d0efab8222df9e63050f6f90dae91ccd520eba66, merge
 * f8045744b3ec0974eeb0ac3feb0ab039302592af) distinguishes an upstream HTML
 * error page from other unusable non-JSON content on the existing non-stream
 * parse-failure path. The status code, the error envelope and every usage or
 * admission effect stay the same; only the diagnostic differs.
 */
describe("non-stream provider HTML error page", () => {
  it.each([
    ["doctype page", HTML_DOCTYPE_PAGE],
    ["captive-portal page", HTML_CAPTIVE_PAGE],
    ["XML error document", XML_ERROR_PAGE],
    ["indented HTML page", "\n   <html><body>bad gateway</body></html>"],
  ])("reports an upstream HTML error page (%s) instead of a generic parse failure", async (_kind, body) => {
    const result = await handleNonStreamingResponse(options(makeProviderResponse(body)));

    expect(result).toMatchObject({
      success: false,
      status: 502,
      error: HTML_MESSAGE,
    });
  });

  it.each([
    ["plain text", "not json at all"],
    ["indented plain text", "  not json at all"],
    ["whitespace only", "   \n  "],
    ["empty body", ""],
    ["a bare angle bracket", "<3"],
  ])("keeps the generic parse-failure diagnostic for other non-JSON content (%s)", async (_kind, body) => {
    const result = await handleNonStreamingResponse(options(makeProviderResponse(body)));

    expect(result).toMatchObject({
      success: false,
      status: 502,
      error: "Invalid JSON response from galadriel",
    });
  });

  it("keeps the generic diagnostic for parsed JSON that is not a record", async () => {
    const result = await handleNonStreamingResponse(options(makeProviderResponse("[]", "application/json")));

    expect(result).toMatchObject({
      success: false,
      status: 502,
      error: "Invalid JSON response from galadriel",
    });
  });

  it("preserves the 502 status code and the safe error envelope for an HTML page", async () => {
    const appendLog = vi.fn();
    const result = await handleNonStreamingResponse({
      ...options(makeProviderResponse(HTML_DOCTYPE_PAGE)),
      appendLog,
    });

    expect(result.status).toBe(502);
    expect(result.response.status).toBe(502);
    await expect(result.response.json()).resolves.toMatchObject({
      error: {
        message: HTML_MESSAGE,
        type: "server_error",
        code: "bad_gateway",
      },
    });
    expect(appendLog).toHaveBeenCalledWith({
      status: "FAILED 502 (html error page)",
    });
  });

  it("keeps the unchanged request-log status for a generic parse failure", async () => {
    const appendLog = vi.fn();
    const result = await handleNonStreamingResponse({
      ...options(makeProviderResponse("  not json at all")),
      appendLog,
    });

    expect(result.status).toBe(502);
    expect(appendLog).toHaveBeenCalledWith({ status: "FAILED 502" });
  });

  it("never echoes the upstream HTML body in the error result or the response", async () => {
    const result = await handleNonStreamingResponse(options(makeProviderResponse(HTML_DOCTYPE_PAGE)));
    const body = await result.response.text();

    expect(result.error).not.toContain("DOCTYPE");
    expect(result.error).not.toContain("nginx");
    expect(body).not.toContain("DOCTYPE");
    expect(body).not.toContain("nginx");
    expect(body).not.toContain("502 Bad Gateway");
  });

  it("still serves a valid JSON provider body as a successful completion", async () => {
    const result = await handleNonStreamingResponse(options(makeProviderResponse(JSON.stringify({
      id: "chatcmpl-valid",
      object: "chat.completion",
      created: 123,
      model: "galadriel-latest",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), "application/json")));

    expect(result.success).toBe(true);
    await expect(result.response.json()).resolves.toMatchObject({
      id: "chatcmpl-valid",
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    });
  });
});

describe("isHtmlErrorPageBody", () => {
  it.each([
    ["<!DOCTYPE html><html></html>", true],
    ["<html><body>x</body></html>", true],
    ["<?xml version=\"1.0\"?><Error/>", true],
    ["  <html>x</html>", true],
    ["\n\t<html>x</html>", true],
  ])("detects an HTML/XML marker in %j", (body, expected) => {
    expect(isHtmlErrorPageBody(body)).toBe(expected);
  });

  it.each([
    ["not json at all", false],
    ["  not json at all", false],
    ["   ", false],
    ["", false],
    ["<3", false],
    ["{\"a\":1}", false],
    ["[1,2,3]", false],
    ["null", false],
  ])("does not treat other non-JSON content as an HTML error page: %j", (body, expected) => {
    expect(isHtmlErrorPageBody(body)).toBe(expected);
  });
});
