/**
 * OpenAI-shaped output and errors for the Microsoft 365 Copilot executor.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/executors/m365ExecutorOutput.ts`
 * at 4265bb2ad5477450a07d3a43ea33a62c6c874878; the typed turn failures, citation annotations and
 * reasoning summaries follow the same file at 5ffa68e835442a12ed1204a2eebf4076c298aecb.
 */
import { sanitizeErrorMessage } from "../utils/error.js";
import { M365TurnError } from "./copilot-m365-turn.js";

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

/** The public error code of a typed failure. */
function failureCode(error) {
  if (error instanceof M365ExecutorError) return error.code;
  if (error.code === "M365_FORBIDDEN") {
    return error.upstreamErrorCode === "InvalidCopilotLicense" ? "m365_account_not_licensed" : "m365_model_not_licensed";
  }
  if (error.code === "M365_THROTTLED") return "m365_throttled";
  if (error.code === "M365_OUT_OF_CREDITS") return "priority_access_exhausted";
  if (error.code === "M365_REASONING_TURNS_EXHAUSTED") return "reasoning_turns_exhausted";
  // A request-scoped safety stop, never an account failure.
  if (error.code === "M365_DISENGAGED") return "provider_safety_rejection";
  return error.code.toLowerCase();
}

/**
 * The public body, status and headers of a failure. Only typed local errors cross the boundary:
 * transport exceptions can carry credentials.
 */
export function m365Failure(error, model) {
  const typed = error instanceof M365ExecutorError || error instanceof M365TurnError ?
  error :
  new M365ExecutorError(502, "m365_executor_error", "Microsoft 365 Copilot request failed.");
  const native = typed instanceof M365TurnError ? typed : undefined;
  const status = typed.status;
  const fields = {};
  if (status === 403 && native?.upstreamErrorCode !== "InvalidCopilotLicense") fields.param = model;
  if (native?.upstreamErrorCode) fields.m365_error_code = native.upstreamErrorCode;
  if (native?.priorityWindow) fields.param = native.priorityWindow;
  const headers = { "Content-Type": "application/json" };
  // Conservative retry backoff, not a claim about a quota-reset timestamp.
  if (status === 429) headers["Retry-After"] = String(native?.retryAfterSeconds ?? 60);
  return {
    body: {
      error: {
        message: sanitizeErrorMessage(typed.message),
        type: ERROR_TYPES[status] || "upstream_error",
        code: failureCode(typed),
        ...fields
      }
    },
    status,
    headers
  };
}

export function m365ErrorResponse(error, model) {
  const failure = m365Failure(error, model);
  return new Response(JSON.stringify(failure.body), { status: failure.status, headers: failure.headers });
}

/**
 * Chat-completion JSON and buffered SSE for a finished turn `{ text, calls, annotations?, reasoning? }`.
 * Citations ride as `url_citation` annotations on the message (offsets index `content`); Copilot's
 * reasoning summary rides as `reasoning_content`, which the Anthropic route turns into a thinking block.
 */
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
  const message = (output) => ({
    role: "assistant",
    content: output.calls.length ? null : output.text || "(empty response)",
    ...(output.reasoning ? { reasoning_content: output.reasoning } : null),
    ...(output.calls.length ? { tool_calls: calls(output) } : null),
    ...(!output.calls.length && output.annotations?.length ? { annotations: output.annotations } : null)
  });
  return {
    chunk,
    json: (output) => new Response(JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message: message(output),
        finish_reason: output.calls.length ? "tool_calls" : "stop"
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }), { headers: { "Content-Type": "application/json" } }),
    bufferedSse: (output) => (output.calls.length ?
    chunk({
      role: "assistant",
      content: null,
      ...(output.reasoning ? { reasoning_content: output.reasoning } : null),
      tool_calls: calls(output).map((call, index) => ({ index, ...call }))
    }) :
    chunk({
      ...(output.reasoning ? { reasoning_content: output.reasoning } : null),
      content: output.text,
      ...(output.annotations?.length ? { annotations: output.annotations } : null)
    })) +
    chunk({}, output.calls.length ? "tool_calls" : "stop") +
    "data: [DONE]\n\n"
  };
}
