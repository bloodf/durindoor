import { corsHeaders } from "@/lib/http/cors.js";
import { randomUUID } from "node:crypto";
import { OPTIONS, POST as chat } from "../../v1/chat/completions/route.js";
import { copyClientAdmissionFailure, inheritHttpObservation, observeHttpRequest } from "open-sse/services/operationalMetrics.js";
import geminiInteractions from "open-sse/providers/registry/gemini-interactions.js";
import { ROLE, OPENAI_FINISH } from "open-sse/translator/schema/index.js";
import { requireJsonContentType } from "open-sse/translator/validate.js";
import { interactionEvent, mapInteractionEvents } from "open-sse/utils/interactionEvents.js";
import { SSE_DONE, SSE_HEADERS_CORS } from "open-sse/utils/sseConstants.js";

import { isBoolean, isRecord, isString } from "@/shared/utils/typeChecks.js";

export { OPTIONS };

const fields = new Set(["model", "input", "stream", "store", "background", "generation_config"]);
const models = new Set(geminiInteractions.models.map(({ id }) => id));
const cors = { ...corsHeaders(["POST", "OPTIONS"]) };

function errorResponse(status, message, headers = {}) {
  return Response.json({ error: { code: status, message } }, { status, headers: { ...cors, ...headers } });
}

function nativeUsage(usage) {
  if (!usage) return undefined;
  const thoughts = usage.completion_tokens_details?.reasoning_tokens;
  return {
    total_input_tokens: usage.prompt_tokens,
    total_output_tokens: usage.completion_tokens === undefined ? undefined : usage.completion_tokens - (thoughts ?? 0),
    total_tokens: usage.total_tokens,
    total_cached_tokens: usage.prompt_tokens_details?.cached_tokens,
    total_thought_tokens: thoughts,
  };
}

function interactionStatus(reason) {
  return reason === OPENAI_FINISH.STOP ? "completed" : "incomplete";
}

async function createInteraction(request) {
  // Apply the gateway JSON policy before parsing or rewriting the client's Content-Type.
  const rejection = requireJsonContentType(request);
  if (rejection) {
    const { error } = await rejection.json();
    return errorResponse(rejection.status, error.message);
  }

  let body;
  try { body = await request.json(); } catch { return errorResponse(400, "Invalid JSON"); }
  const model = isString(body?.model)
    ? body.model.replace(/^(?:models\/)?(?:gemini-interactions\/)?/, "") : "";
  if (!models.has(model) || !isString(body.input) || !body.input.trim() ||
      Object.keys(body).some((field) => !fields.has(field)) ||
      (body.stream !== undefined && !isBoolean(body.stream)) ||
      (body.store !== undefined && body.store !== false) ||
      (body.background !== undefined && body.background !== false) ||
      (body.generation_config !== undefined && (!isRecord(body.generation_config) ||
        Object.keys(body.generation_config).some((key) => key !== "thinking_level") ||
        model !== "gemini-4-hydrogen" ||
        !["low", "medium", "high", "xhigh"].includes(body.generation_config.thinking_level)))) {
    return errorResponse(400, "Expected an Interactions text model and a nonempty text input with store=false");
  }

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", body.stream ? "text/event-stream" : "application/json");
  headers.delete("content-length");
  const chatBody = {
    model: `${geminiInteractions.id}/${model}`,
    messages: [{ role: ROLE.USER, content: body.input }],
    stream: body.stream === true,
  };
  if (body.generation_config) chatBody.reasoning_effort = body.generation_config.thinking_level;
  if (body.stream) chatBody.stream_options = { include_usage: true };
  const adapted = new Request(request.url, {
    method: "POST",
    headers,
    signal: request.signal,
    body: JSON.stringify(chatBody),
  });
  inheritHttpObservation(adapted);
  const response = await chat(adapted);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const retryAfter = response.headers.get("retry-after");
    return copyClientAdmissionFailure(response, errorResponse(response.status,
      payload?.error?.message || "Interaction request failed", retryAfter ? { "Retry-After": retryAfter } : {}));
  }

  // This ID identifies the current response only. No interaction is retained.
  const interaction = { id: `local_${randomUUID()}`, object: "interaction", model };
  if (!body.stream) {
    const reply = await response.json();
    const choice = reply.choices[0];
    return Response.json({
      ...interaction,
      status: interactionStatus(choice.finish_reason),
      steps: [{ type: "model_output", content: [{ type: "text", text: choice.message.content }] }],
      usage: nativeUsage(reply.usage),
    }, { headers: cors });
  }

  let started = false;
  let terminal = false;
  let reason;
  let usage;
  const emit = (event_type, data) => `event: ${event_type}\n` + interactionEvent({ event_type, ...data });
  const fail = () => emit("error", { error: { code: "upstream_error", message: "Interaction stream failed" } });
  const mapped = mapInteractionEvents(response.body, (event) => {
    if (terminal) return "";
    if (!event || event.error) {
      terminal = true;
      return fail();
    }
    const choice = event.choices?.[0];
    reason ??= choice?.finish_reason;
    usage = nativeUsage(event.usage) ?? usage;
    let output = "";
    if (!started) {
      started = true;
      output = emit("interaction.created", { interaction: { ...interaction, status: "in_progress" } }) +
        emit("step.start", { index: 0, step: { type: "model_output" } });
    }
    if (isString(choice?.delta?.content)) {
      output += emit("step.delta", { index: 0, delta: { type: "text", text: choice.delta.content } });
    }
    return output;
  }, () => {
    if (terminal) return "";
    if (!reason || reason === OPENAI_FINISH.ERROR) return fail();
    return emit("step.stop", { index: 0 }) +
      emit("interaction.completed", { interaction: { ...interaction, status: interactionStatus(reason), usage } }) +
      `event: done\n${SSE_DONE}`;
  });
  return new Response(mapped, { headers: SSE_HEADERS_CORS });
}

export const POST = (request) => observeHttpRequest(request, () => createInteraction(request));
