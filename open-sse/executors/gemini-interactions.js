import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { GEMINI_INTERACTIONS_ID } from "../providers/registry/gemini-interactions.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { FORMATS } from "../translator/formats.js";
import { OPENAI_BLOCK, OPENAI_FINISH, ROLE } from "../translator/schema/index.js";
import { readBoundedResponseText } from "../utils/error.js";
import { interactionEvent, mapInteractionEvents } from "../utils/interactionEvents.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const streamError = { error: { message: "Gemini Interactions failed or ended before completion", type: "upstream_error" } };

function textMessage(message) {
  if (isString(message?.content)) return message.content;
  if (Array.isArray(message?.content) && message.content.length &&
      message.content.every((part) => part?.type === OPENAI_BLOCK.TEXT && isString(part.text))) {
    return message.content.map((part) => part.text).join("");
  }
  return null;
}

function interactionUsage(usage) {
  if (!usage) return undefined;
  const { total_input_tokens, total_output_tokens, total_tokens, total_cached_tokens, total_thought_tokens } = usage;
  const tokens = {
    prompt_tokens: total_input_tokens,
    completion_tokens: total_output_tokens === undefined ? undefined : total_output_tokens + (total_thought_tokens ?? 0),
    total_tokens,
  };
  if (total_cached_tokens !== undefined) tokens.prompt_tokens_details = { cached_tokens: total_cached_tokens };
  if (total_thought_tokens !== undefined) tokens.completion_tokens_details = { reasoning_tokens: total_thought_tokens };
  return tokens;
}

function completionReason(interaction) {
  if (interaction?.finish_reason === "content_filter") return OPENAI_FINISH.CONTENT_FILTER;
  if (interaction?.status === "incomplete") return OPENAI_FINISH.LENGTH;
  if (interaction?.status === "completed") return OPENAI_FINISH.STOP;
  return null;
}

// Protocol reference: CLIProxyAPI internal/runtime/executor/gemini_executor.go
// and internal/translator/openai/interactions/chat-completions/openai_interactions_response.go.
export class GeminiInteractionsExecutor extends BaseExecutor {
  constructor() {
    super(GEMINI_INTERACTIONS_ID, PROVIDERS[GEMINI_INTERACTIONS_ID]);
  }

  buildHeaders(credentials, stream) {
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": credentials.apiKey,
      "Api-Revision": "2026-05-20",
      Accept: stream ? "text/event-stream" : "application/json",
    };
  }

  transformRequest(model, body, stream) {
    const input = textMessage(body.messages[0]);
    const maxOutput = body.max_completion_tokens ?? body.max_tokens;
    const request = { model, input, stream, store: false };
    const generation = {};
    if (Number.isInteger(maxOutput) && maxOutput > 0) generation.max_output_tokens = maxOutput;
    if (Number.isFinite(body.temperature)) generation.temperature = body.temperature;
    if (model === "gemini-4-hydrogen" && ["low", "medium", "high", "xhigh"].includes(body.reasoning_effort)) {
      generation.thinking_level = body.reasoning_effort;
    }
    if (Object.keys(generation).length) request.generation_config = generation;
    return request;
  }

  async execute(options) {
    const { body, credentials, model, stream, signal } = options;
    if (!credentials?.apiKey) {
      return { response: Response.json({ error: { message: "Gemini Interactions requires an API key" } }, { status: 401 }) };
    }
    if (body.messages?.length !== 1 || body.messages[0]?.role !== ROLE.USER ||
        !textMessage(body.messages[0])?.trim() || body.tools?.length || body.messages[0].tool_calls?.length ||
        (body.n !== undefined && body.n !== 1)) {
      return { response: Response.json({ error: { message: "Gemini Interactions requires one text-only user message" } }, { status: 400 }) };
    }

    const result = await super.execute(options);
    const upstream = result.response;
    if (!upstream.ok) return result;
    const base = { id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model };
    let response;
    if (stream && upstream.body && upstream.headers.get("content-type")?.includes("text/event-stream")) {
      let terminal = false;
      const outputSteps = new Set();
      const chunk = (delta, finish_reason = null, usage) =>
        interactionEvent({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }], usage });
      const mapped = mapInteractionEvents(upstream.body, (event) => {
        if (terminal) return "";
        switch (event?.event_type) {
          case "interaction.created":
            return chunk({ role: ROLE.ASSISTANT });
          case "step.start":
            if (event.step?.type === "model_output") outputSteps.add(event.index);
            return "";
          case "step.stop":
            outputSteps.delete(event.index);
            return "";
          case "step.delta":
            return outputSteps.has(event.index) && event.delta?.type === "text" && isString(event.delta.text)
              ? chunk({ content: event.delta.text }) : "";
          case "interaction.completed": {
            terminal = true;
            const reason = completionReason(event.interaction);
            return reason ? chunk({}, reason, interactionUsage(event.interaction?.usage ?? event.usage)) + SSE_DONE
              : interactionEvent(streamError);
          }
          case "interaction.failed":
          case "error":
          case undefined:
            terminal = true;
            return interactionEvent(streamError);
          default:
            return "";
        }
      }, () => terminal ? "" : interactionEvent(streamError));
      response = new Response(mapped, { headers: SSE_HEADERS });
    } else {
      let interaction;
      try {
        const value = JSON.parse(await readBoundedResponseText(upstream, { signal, maxBytes: 8 * 1024 * 1024, timeoutMs: 120_000 }));
        interaction = value.interaction ?? value;
      } catch (error) {
        if (signal?.aborted) throw error;
      }
      const reason = completionReason(interaction);
      if (!reason || stream) {
        response = Response.json(streamError, { status: 502 });
      } else {
        const content = (interaction.steps || []).filter((step) => step.type === "model_output")
          .flatMap((step) => step.content || []).filter((part) => part.type === "text")
          .map((part) => part.text).join("");
        response = Response.json({
          ...base, object: "chat.completion",
          choices: [{ index: 0, message: { role: ROLE.ASSISTANT, content }, finish_reason: reason }],
          usage: interactionUsage(interaction.usage),
        });
      }
    }
    transferProviderAttemptDispatch(upstream, response);
    return { ...result, response, responseFormat: FORMATS.OPENAI };
  }
}
