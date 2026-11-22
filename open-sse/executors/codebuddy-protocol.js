import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

/** Normalize optional reasoning parameters and omit empty tool lists. */
export function normalizeCodeBuddyRequest(body) {
  body.stream = true;
  const effort = isString(body.reasoning_effort) ? body.reasoning_effort.trim().toLowerCase() : body.reasoning_effort;
  if (!effort || effort === "none" || effort === "off") {
    delete body.reasoning_effort;
    delete body.reasoning_summary;
  } else if (!body.reasoning_summary) {
    body.reasoning_summary = "auto";
  }
  if (Array.isArray(body.tools) && body.tools.length === 0) delete body.tools;
  return body;
}

/** Normalize SSE chunks while retaining provider dispatch metadata. */
export function normalizeCodeBuddyResponse(result) {
  const response = result.response;
  if (!response?.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return result;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  const rewrite = (line) => {
    if (!line.startsWith("data:")) return line;
    try {
      const chunk = JSON.parse(line.slice(5));
      if (!Array.isArray(chunk.choices)) return line;
      for (const choice of chunk.choices) {
        if (choice.finish_reason === "") choice.finish_reason = null;
        const call = choice.delta?.function_call;
        if (call && !call.name && !call.arguments) delete choice.delta.function_call;
      }
      return `data: ${JSON.stringify(chunk)}`;
    } catch { return line; }
  };
  const transform = new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop();
      if (lines.length) controller.enqueue(encoder.encode(lines.map(rewrite).join("\n") + "\n"));
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending) controller.enqueue(encoder.encode(rewrite(pending)));
    },
  });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const normalized = new Response(response.body.pipeThrough(transform), { status: response.status, statusText: response.statusText, headers });
  transferProviderAttemptDispatch(response, normalized);
  return { ...result, response: normalized };
}
