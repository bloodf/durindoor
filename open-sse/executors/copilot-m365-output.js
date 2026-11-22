/**
 * OpenAI-shaped output and errors for the Microsoft 365 Copilot executor.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/executors/m365ExecutorOutput.ts`
 * at 4265bb2ad5477450a07d3a43ea33a62c6c874878, trimmed to what this executor produces (text and
 * tool calls; no citations or reasoning summaries).
 */
import { sanitizeErrorMessage } from "../utils/error.js";

/** A typed local failure: only these cross the boundary, transport exceptions can carry credentials. */
export class M365ExecutorError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "M365ExecutorError";
    this.status = status;
    this.code = code;
  }
}

const ERROR_TYPES = {
  400: "invalid_request_error",
  401: "authentication_error",
  403: "permission_error",
  429: "rate_limit_error"
};

export function m365ErrorResponse(error, model) {
  const typed = error instanceof M365ExecutorError ?
  error :
  new M365ExecutorError(502, "m365_executor_error", "Microsoft 365 Copilot request failed.");
  const headers = { "Content-Type": "application/json" };
  if (typed.status === 429) headers["Retry-After"] = "60";
  return new Response(JSON.stringify({
    error: {
      message: sanitizeErrorMessage(typed.message),
      type: ERROR_TYPES[typed.status] || "upstream_error",
      code: typed.code,
      ...(typed.status === 403 ? { param: model } : null)
    }
  }), { status: typed.status, headers });
}

/** Chat-completion JSON and buffered SSE for a finished turn `{ text, calls }`. */
export function m365Output(model) {
  const id = `chatcmpl-copilot-m365-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }]
  })}\n\n`;
  const calls = (output) => output.calls.map((call) => ({
    id: call.id,
    type: call.type,
    function: { name: call.name, arguments: call.arguments }
  }));
  return {
    chunk,
    json: (output) => new Response(JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: output.calls.length ? null : output.text || "(empty response)",
          ...(output.calls.length ? { tool_calls: calls(output) } : null)
        },
        finish_reason: output.calls.length ? "tool_calls" : "stop"
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }), { headers: { "Content-Type": "application/json" } }),
    bufferedSse: (output) => (output.calls.length ?
    chunk({
      role: "assistant",
      content: null,
      tool_calls: calls(output).map((call, index) => ({ index, ...call }))
    }) :
    chunk({ content: output.text })) +
    chunk({}, output.calls.length ? "tool_calls" : "stop") +
    "data: [DONE]\n\n"
  };
}
