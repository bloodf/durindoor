import { describe, expect, it, vi } from "vitest";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { createErrorResult, parseUpstreamError } from "../../open-sse/utils/error.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { toResponsesContextFailure } from "../../src/sse/handlers/chat/contextOverflow.js";
import { handleChat } from "../../src/sse/handlers/chat.js";

const { dispatchChat } = vi.hoisted(() => ({ dispatchChat: vi.fn() }));
vi.mock("../../src/sse/handlers/chat/combo.js", async (importOriginal) => ({ ...await importOriginal(), dispatchChat }));
vi.mock("../../src/sse/services/admission.js", () => ({
  admit: async () => ({ settings: {}, apiKey: null, auth: {}, error: null }),
}));

const MESSAGE = "Your input exceeds the context window of this model. Please adjust your input and try again.";
const upstream = (error, status = 400) => new Response(JSON.stringify({ error }), { status });

async function clientError(response) {
  const parsed = await parseUpstreamError(response, new GithubExecutor());
  return createErrorResult(parsed.statusCode, parsed.message, parsed.resetsAtMs, parsed.errorBody).response;
}

describe("upstream PR #5280 - Copilot context overflow", () => {
  it.each([
    ["Copilot's invalid_request_body rejection", { code: "invalid_request_body", message: MESSAGE }],
    ["the Claude token preflight", { code: "context_length_exceeded", type: "invalid_request_error", message: MESSAGE }],
  ])("reports %s as context_length_exceeded", async (_label, error) => {
    const response = await clientError(upstream(error));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({ message: MESSAGE, type: "invalid_request_error", code: "context_length_exceeded" });
  });

  it.each([
    [400, "invalid_request_body", "Missing required field input"],
    [403, "invalid_request_body", MESSAGE],
    [400, "unsupported_model", MESSAGE],
  ])("leaves other Copilot errors alone (%s %s)", async (status, code, message) => {
    const response = await clientError(upstream({ code, message }, status));
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).not.toBe("context_length_exceeded");
  });

  it("delivers the overflow to a streaming Responses client as response.failed", async () => {
    const failed = await clientError(upstream({ code: "invalid_request_body", message: MESSAGE }));
    const response = await toResponsesContextFailure(failed, { stream: true, sourceFormat: FORMATS.OPENAI_RESPONSES });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const text = await response.text();
    expect(text.startsWith("event: response.failed\n")).toBe(true);
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
    const event = JSON.parse(text.split("\n")[1].slice("data: ".length));
    expect(event.response).toMatchObject({ status: "failed", error: { code: "context_length_exceeded", message: MESSAGE } });
  });

  it.each([
    ["/v1/responses", "text/event-stream", 200],
    ["/v1/chat/completions", "application/json", 400],
  ])("converts only after routing has finished (%s)", async (path, contentType, status) => {
    dispatchChat.mockResolvedValue(await clientError(upstream({ code: "invalid_request_body", message: MESSAGE })));
    const body = path === "/v1/responses" ? { input: "hi" } : { messages: [{ role: "user", content: "hi" }] };
    const response = await handleChat(new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "github/gpt-4o", stream: true, ...body }),
    }));
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain(contentType);
    expect(await response.text()).toContain("context_length_exceeded");
  });

  it.each([
    ["a non-streaming Responses request", { stream: false, sourceFormat: FORMATS.OPENAI_RESPONSES }, "context_length_exceeded", 400],
    ["a streaming Chat Completions request", { stream: true, sourceFormat: FORMATS.OPENAI }, "context_length_exceeded", 400],
    ["an unrelated bad request", { stream: true, sourceFormat: FORMATS.OPENAI_RESPONSES }, "bad_request", 400],
    ["a non-400 status", { stream: true, sourceFormat: FORMATS.OPENAI_RESPONSES }, "context_length_exceeded", 413],
  ])("keeps the HTTP error for %s", async (_label, request, code, status) => {
    const failed = Response.json({ error: { code, message: MESSAGE } }, { status });
    const response = await toResponsesContextFailure(failed, request);
    expect(response).toBe(failed);
    expect((await response.json()).error.code).toBe(code);
  });
});
