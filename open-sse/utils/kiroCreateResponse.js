/**
 * Kiro CreateResponse Protocol Adapter (/v1/responses)
 * Converts Kiro conversation state payloads into CreateResponse request bodies,
 * formats authentication headers, and translates CreateResponse SSE streams
 * into standard OpenAI-compatible Server-Sent Events.
 */

import { isString, isObject } from "../../src/shared/utils/typeChecks.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../translator/schema/index.js";
import { normalizeKiroRegion } from "../config/kiroRegions.js";

const encoder = new TextEncoder();

export const KIRO_RESPONSES_DEFAULT_HOST = "https://runtime.us-east-1.kiro.dev/v1/responses";
export const KIRO_IDE_ACP_USER_AGENT = "KiroIDE-1.4.154-KiroIDE/acp-client";

/**
 * Build CreateResponse API URL for the configured AWS region.
 *
 * @param {string} [region="us-east-1"]
 * @returns {string}
 */
export function buildKiroCreateResponseUrl(region = "us-east-1") {
  try {
    return `https://runtime.${normalizeKiroRegion(region)}.kiro.dev/v1/responses`;
  } catch {
    return KIRO_RESPONSES_DEFAULT_HOST;
  }
}

/**
 * Convert Kiro conversation state request body to CreateResponse API format.
 *
 * @param {Object} params
 * @param {Object} params.body - Kiro translated body with conversationState
 * @param {Object} [params.credentials]
 * @param {string} params.model
 * @returns {Object}
 */
export function buildKiroCreateResponseBody({ body, credentials, model }) {
  const cs = body?.conversationState;
  const current = cs?.currentMessage;
  const history = cs?.history || [];
  const turns = [...history, current].filter(Boolean);

  const input = [];
  for (const turn of turns) {
    const u = turn.userInputMessage;
    if (u) {
      // 1. Tool result outputs
      const toolResults = u.userInputMessageContext?.toolResults || [];
      for (const r of toolResults) {
        input.push({
          type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
          call_id: r.toolUseId,
          output: (r.content || []).map((p) => p.text ?? "").join("\n")
        });
      }

      // 2. Input images
      const images = (u.images || [])
        .filter((img) => img.source?.bytes)
        .map((img) => ({
          type: RESPONSES_ITEM.INPUT_IMAGE,
          image_url: `data:image/${String(img.format || "png").toLowerCase()};base64,${img.source.bytes}`
        }));

      // 3. User content
      const text = isString(u.content) ? u.content : "";
      if (images.length > 0) {
        input.push({
          role: ROLE.USER,
          content: [...(text ? [{ type: RESPONSES_ITEM.INPUT_TEXT, text }] : []), ...images]
        });
      } else if (text) {
        input.push({ role: ROLE.USER, content: text });
      }
    }

    const m = turn.assistantResponseMessage;
    if (m) {
      if (isString(m.content) && m.content) {
        input.push({ role: ROLE.ASSISTANT, content: m.content });
      }
      const toolUses = m.toolUses || [];
      for (const c of toolUses) {
        input.push({
          type: RESPONSES_ITEM.FUNCTION_CALL,
          call_id: c.toolUseId,
          name: c.name,
          arguments: isString(c.input) ? c.input : JSON.stringify(c.input ?? {})
        });
      }
    }
  }

  // Extract tool specifications from current message context
  const tools = [];
  const rawTools = current?.userInputMessage?.userInputMessageContext?.tools || [];
  for (const t of rawTools) {
    const s = t.toolSpecification;
    if (s?.name) {
      tools.push({
        type: OPENAI_BLOCK.FUNCTION,
        name: s.name,
        description: s.description || "",
        parameters: s.inputSchema?.json || {}
      });
    }
  }

  // Extract thinking / reasoning configuration
  let reasoning;
  const f = body?.additionalModelRequestFields;
  if (f && isObject(f)) {
    const str = (v) => (isString(v) && v ? v : undefined);
    const type = str(f.thinking?.type);
    const effort = str(f.output_config?.effort) ?? str(f.reasoning?.effort);
    const summary = str(f.thinking?.display);
    if (type || effort || summary) {
      reasoning = {};
      if (type) reasoning.type = type;
      if (effort) reasoning.effort = effort;
      if (summary) reasoning.summary = summary;
    }
  }

  const profileArn = body?.profileArn || credentials?.providerSpecificData?.profileArn || undefined;
  const conversationId = cs?.conversationId;
  const metadata = { "kiro:agent_mode": "vibe" };
  if (conversationId) metadata["kiro:conversation_id"] = conversationId;

  const resolvedModel = current?.userInputMessage?.modelId || body?._kiroUpstreamModel || model;

  const result = {
    model: resolvedModel,
    input,
    stream: true,
    origin: current?.userInputMessage?.origin || "AI_EDITOR",
    metadata,
  };
  if (tools.length) result.tools = tools;
  if (profileArn) result.profileArn = profileArn;
  if (reasoning) result.reasoning = reasoning;
  return result;
}

/**
 * Build request headers for CreateResponse API.
 *
 * @param {Object} params
 * @param {Object} [params.credentials]
 * @param {Object} [params.body]
 * @returns {Record<string, string>}
 */
export function buildKiroCreateResponseHeaders({ credentials, body }) {
  const token = credentials?.accessToken || credentials?.apiKey || "";
  const authMethod = credentials?.providerSpecificData?.authMethod;
  const profileArn = credentials?.providerSpecificData?.profileArn || body?.profileArn;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-amzn-kiro-origin": "AI_EDITOR",
    "x-amzn-codewhisperer-optout": "true",
    "User-Agent": KIRO_IDE_ACP_USER_AGENT,
    "x-amzn-kiro-attempt": "1;max=3"
  };

  if (profileArn) {
    headers["x-amzn-kiro-profile"] = profileArn;
  }

  if (authMethod === "api_key" && (credentials?.apiKey || credentials?.accessToken)) {
    headers["TokenType"] = "API_KEY";
  } else if (authMethod === "external_idp") {
    headers["TokenType"] = "EXTERNAL_IDP";
  }

  if (credentials?.accessToken) {
    headers["x-amz-sso-bearer"] = credentials.accessToken;
  }

  return headers;
}

/**
 * Transform CreateResponse SSE stream to standard OpenAI chat completion chunk stream.
 *
 * @param {ReadableStream} responseStream - Upstream SSE response stream
 * @param {string} model - Requested model name
 * @returns {ReadableStream}
 */
export function transformCreateResponseStreamToSSE(responseStream, model) {
  const id = `chatcmpl-cr-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const sseChunk = (delta, finish = null, usage = null) => {
    const chunkObj = {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    };
    if (usage) chunkObj.usage = usage;
    return encoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`);
  };

  let toolIdx = -1;
  let curCallId = null;
  const openCalls = new Set();
  const arguedCalls = new Set();
  let hasToolCalls = false;
  let emittedRole = false;
  let completed = false;
  let reader;

  return new ReadableStream({
    async start(controller) {
      reader = responseStream.getReader();
      let buffer = "";
      const decoder = new TextDecoder();

      const processEvent = (event) => {
        const type = event?.type ?? "";

        // 1. Text output delta
        if (type === "response.output_text.delta" && isString(event.delta)) {
          controller.enqueue(
            sseChunk(emittedRole ? { content: event.delta } : { role: ROLE.ASSISTANT, content: event.delta })
          );
          emittedRole = true;
        }

        // 2. Reasoning / thinking delta
        else if (
          (type === "response.reasoning_text.delta" || type === "response.reasoning.delta") &&
          isString(event.delta)
        ) {
          controller.enqueue(
            sseChunk(
              emittedRole
                ? { reasoning_content: event.delta }
                : { role: ROLE.ASSISTANT, reasoning_content: event.delta }
            )
          );
          emittedRole = true;
        }

        // 3. Refusal deltas
        else if (type === "response.refusal.delta" && isString(event.delta)) {
          controller.enqueue(
            sseChunk(emittedRole ? { content: event.delta } : { role: ROLE.ASSISTANT, content: event.delta })
          );
          emittedRole = true;
        } else if (type === "response.refusal.done" && isString(event.refusal) && event.refusal) {
          controller.enqueue(sseChunk({ content: event.refusal }));
        }

        // 4. Function call initiation
        else if (type === "response.output_item.added" && event.item?.type === RESPONSES_ITEM.FUNCTION_CALL) {
          curCallId = event.item.call_id ?? event.item.id ?? "";
          openCalls.add(curCallId);
          hasToolCalls = true;
          toolIdx++;
          controller.enqueue(
            sseChunk({
              tool_calls: [
                {
                  index: toolIdx,
                  id: curCallId,
                  type: OPENAI_BLOCK.FUNCTION,
                  function: { name: event.item.name || "", arguments: "" }
                }
              ]
            })
          );
          emittedRole = true;
        }

        // 5. Function call argument streaming
        else if (type === "response.function_call_arguments.delta" && isString(event.delta)) {
          if (curCallId) arguedCalls.add(curCallId);
          controller.enqueue(
            sseChunk({
              tool_calls: [{ index: toolIdx, function: { arguments: event.delta } }]
            })
          );
        }

        // 6. Function call completion
        else if (type === "response.output_item.done" && event.item?.type === RESPONSES_ITEM.FUNCTION_CALL) {
          const callId = event.item.call_id ?? event.item.id ?? "";
          if (openCalls.has(callId)) {
            openCalls.delete(callId);
            if (!arguedCalls.delete(callId) && event.item.arguments) {
              controller.enqueue(
                sseChunk({
                  tool_calls: [{ index: toolIdx, function: { arguments: event.item.arguments } }]
                })
              );
            }
          }
        }

        // 7. Stream completion / incomplete
        else if (type === "response.completed" || type === "response.incomplete") {
          completed = true;
          const res = event.response || {};
          const incomplete = type === "response.incomplete" || res.status === "incomplete";
          const stopReasonMap = {
            max_output_tokens: "length",
            content_filter: "content_filter",
            compaction_required_for_model_handoff: "length"
          };
          const finishReason =
            (incomplete && stopReasonMap[res.incomplete_details?.reason]) ||
            (hasToolCalls ? "tool_calls" : "stop");

          let usage;
          if (res.usage) {
            const inputTokens = res.usage.input_tokens || 0;
            const outputTokens = res.usage.output_tokens || 0;
            usage = {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens
            };
          }

          controller.enqueue(sseChunk({}, finishReason, usage));
        }

        // 8. Stream errors
        else if (type === "error" || type === "response.failed") {
          const err = type === "error" ? event.error : event.response?.error;
          throw new Error(`CreateResponse stream failed: ${JSON.stringify(err ?? {})}`);
        }
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          if (buffer.length > 8 * 1024 * 1024) throw new Error("CreateResponse event exceeds limit");
          const lines = buffer.split("\n");
          buffer = done ? "" : lines.pop() ?? "";

          for (let line of lines) {
            line = line.replace(/\r$/, "").trim();
            if (!line.startsWith("data:")) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === "[DONE]") continue;

            let parsed;
            try {
              parsed = JSON.parse(dataStr);
            } catch {
              continue;
            }
            processEvent(parsed);
          }

          if (done) break;
        }

        if (!completed) throw new Error("CreateResponse stream ended before completion");
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        try {
          controller.error(err);
        } catch {}
      }
    },
    cancel() {
      try {
        reader?.cancel();
      } catch {}
    }
  });
}
