import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand } from
"@aws-sdk/client-bedrock-runtime";
import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import {
  buildBedrockNativeConverseUrl,
  resolveBedrockRegion } from
"../config/bedrock.js";
import { buildBedrockClientAuth } from "../shared/awsCredentials.js";
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const encoder = new TextEncoder();

function asRecord(value) {
  return value && isObject(value) && !Array.isArray(value) ? value : {};
}

function toText(value) {
  if (isString(value)) return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeRole(role) {
  return role === "assistant" ? "assistant" : "user";
}

function stripDataUrlPrefix(value) {
  if (!isString(value)) return null;
  const match = value.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i);
  if (!match) return null;
  return { format: match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase(), data: match[2] };
}

function textBlocksFromContent(content) {
  if (isString(content)) return content.trim() ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const part of content) {
    if (isString(part)) {
      if (part.trim()) blocks.push({ text: part });
      continue;
    }
    const p = asRecord(part);
    const type = isString(p.type) ? p.type : "";
    if ((type === "text" || type === "input_text") && isString(p.text)) {
      if (p.text.trim()) blocks.push({ text: p.text });
      continue;
    }
    if (type === "image_url" || type === "input_image") {
      const url = isString(p.image_url) ? p.image_url : p.image_url?.url || p.image_url;
      if (isString(url) && /^https?:\/\//i.test(url)) {
        throw new Error(`Bedrock does not support remote image URLs; inline the image as a data URI or use a provider that prefetches images (${url.slice(0, 60)})`);
      }
      const image = stripDataUrlPrefix(url);
      if (image) {
        blocks.push({
          image: {
            format: image.format,
            source: { bytes: Uint8Array.from(Buffer.from(image.data, "base64")) }
          }
        });
      }
      continue;
    }
    if (type === "tool_result" && isString(p.tool_use_id)) {
      blocks.push({
        toolResult: {
          toolUseId: p.tool_use_id,
          content: [{ text: toText(p.content) || " " }],
          status: p.is_error ? "error" : "success"
        }
      });
    }
  }
  return blocks;
}

function systemBlocksFromOpenAI(messages) {
  return messages.
  filter((message) => message?.role === "system" || message?.role === "developer").
  map((message) =>
  textBlocksFromContent(message.content).
  map((block) => block.text || "").
  filter(Boolean).
  join("\n")
  ).
  filter((text) => text.trim()).
  map((text) => ({ text }));
}

function toolResultContentFromMessage(message) {
  if (isString(message.content)) return [{ text: message.content || " " }];
  if (!Array.isArray(message.content)) return [{ text: toText(message.content) || " " }];
  const result = [];
  for (const part of message.content) {
    if (isString(part)) result.push({ text: part || " " });else
    if (isString(part?.text)) result.push({ text: part.text || " " });else
    if (part?.json !== undefined) result.push({ json: part.json });else
    if (part?.content !== undefined) result.push({ text: toText(part.content) || " " });
  }
  return result.length > 0 ? result : [{ text: " " }];
}

function groupToolResults(messages) {
  const groups = [];
  for (const message of messages) {
    if (message?.role === "tool") {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.role === "tool") {
        lastGroup.results.push(message);
        continue;
      }
      groups.push({ role: "tool", results: [message] });
      continue;
    }
    groups.push(message);
  }
  return groups.map((group) => {
    if (group.role === "tool") {
      return {
        role: "user",
        content: group.results.map((m) => ({
          toolResult: {
            toolUseId: m.tool_call_id || `toolu_${randomUUID()}`,
            content: toolResultContentFromMessage(m),
            status: "success"
          }
        }))
      };
    }
    return group;
  });
}

function messagesFromOpenAI(messages) {
  const converted = [];
  for (const message of groupToolResults(messages)) {
    if (!message || !isObject(message)) continue;
    if (message.role === "system" || message.role === "developer") continue;
    if (message.role === "tool") {
      converted.push({
        role: "user",
        content: [
        {
          toolResult: {
            toolUseId: message.tool_call_id || `toolu_${randomUUID()}`,
            content: toolResultContentFromMessage(message),
            status: "success"
          }
        }]

      });
      continue;
    }
    if (Array.isArray(message.content) && message.content.some((block) => block?.toolResult)) {
      converted.push(message);
      continue;
    }
    const content = textBlocksFromContent(message.content);
    for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      const fn = asRecord(call.function);
      let input = {};
      try {
        input = isString(fn.arguments) && fn.arguments.trim() ? JSON.parse(fn.arguments) : {};
      } catch {
        input = { arguments: fn.arguments };
      }
      content.push({
        toolUse: {
          toolUseId: call.id || `toolu_${randomUUID()}`,
          name: isString(fn.name) && fn.name ? fn.name : "unknown_tool",
          input
        }
      });
    }
    converted.push({ role: normalizeRole(message.role), content: content.length ? content : [{ text: " " }] });
  }
  return converted.length ? converted : [{ role: "user", content: [{ text: " " }] }];
}

function toolConfigFromOpenAI(tools, toolChoice) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const bedrockTools = [];
  for (const tool of tools) {
    const record = asRecord(tool);
    const fn = record.type === "function" ? asRecord(record.function) : record;
    const name = isString(fn.name) ? fn.name.trim() : "";
    if (!name) continue;
    bedrockTools.push({
      toolSpec: {
        name,
        description: isString(fn.description) ? fn.description : undefined,
        inputSchema: { json: asRecord(fn.parameters) }
      }
    });
  }
  if (bedrockTools.length === 0) return undefined;
  if (toolChoice === "none") return undefined;
  const config = { tools: bedrockTools };
  if (toolChoice === "required") config.toolChoice = { any: {} };else
  if (toolChoice === "auto") config.toolChoice = { auto: {} };else
  if (toolChoice && isObject(toolChoice)) {
    const name = asRecord(toolChoice.function).name;
    if (isString(name) && name) config.toolChoice = { tool: { name } };
  }
  return config;
}

export function openAIToBedrockConverse(model, body) {
  const request = asRecord(body);
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const inferenceConfig = {};
  const maxTokens = request.max_tokens ?? request.max_completion_tokens;
  if (isNumber(maxTokens)) inferenceConfig.maxTokens = Math.max(1, Math.floor(maxTokens));
  if (isNumber(request.temperature)) inferenceConfig.temperature = request.temperature;
  if (isNumber(request.top_p)) inferenceConfig.topP = request.top_p;
  if (isClaudeSonnetHaiku45(model) && isNumber(request.temperature) && isNumber(request.top_p)) {
    delete inferenceConfig.temperature;
  }
  if (Array.isArray(request.stop)) inferenceConfig.stopSequences = request.stop.filter(Boolean);else
  if (isString(request.stop) && request.stop) inferenceConfig.stopSequences = [request.stop];

  const payload = { modelId: model, messages: messagesFromOpenAI(messages) };
  const system = systemBlocksFromOpenAI(messages);
  if (system.length > 0) payload.system = system;
  if (Object.keys(inferenceConfig).length > 0) payload.inferenceConfig = inferenceConfig;
  const toolConfig = toolConfigFromOpenAI(request.tools, request.tool_choice);
  if (toolConfig) payload.toolConfig = toolConfig;
  if (request.thinking && isObject(request.thinking) && !Array.isArray(request.thinking)) {
    payload.additionalModelRequestFields = { ...payload.additionalModelRequestFields, thinking: request.thinking };
  }
  return payload;
}

function convertStopReason(reason) {
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  if (reason === "content_filtered" || reason === "guardrail_intervened") return "content_filter";
  if (reason === "model_context_window_exceeded") return "length";
  return "stop";
}

function usageFromBedrock(usage) {
  const input = Number(usage?.inputTokens || 0);
  const output = Number(usage?.outputTokens || 0);
  return { prompt_tokens: input, completion_tokens: output, total_tokens: Number(usage?.totalTokens || input + output) };
}

function isClaudeSonnetHaiku45(model) {
  if (!isString(model)) return false;
  return /claude-(sonnet|haiku)-4-5/.test(model.toLowerCase());
}

function contentBlocksToOpenAIMessage(blocks) {
  const text = [];
  const toolCalls = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (isString(block?.text)) text.push(block.text);
    if (block?.toolUse) {
      toolCalls.push({
        id: block.toolUse.toolUseId,
        type: "function",
        function: { name: block.toolUse.name, arguments: JSON.stringify(block.toolUse.input || {}) }
      });
    }
  }
  const message = { role: "assistant", content: text.join("") };
  if (toolCalls.length) {
    message.content = message.content || null;
    message.tool_calls = toolCalls;
  }
  return message;
}

function openAICompletionFromConverse(output, model) {
  return {
    id: `chatcmpl-bedrock-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
    {
      index: 0,
      message: contentBlocksToOpenAIMessage(output?.output?.message?.content || []),
      finish_reason: convertStopReason(output?.stopReason)
    }],

    usage: usageFromBedrock(output?.usage)
  };
}

function openAIChunk(model, delta, finishReason = null, usage = undefined) {
  const chunk = {
    id: `chatcmpl-bedrock-${model}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  };
  if (usage) chunk.usage = usage;
  return chunk;
}

function sse(data) {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function createOpenAIStreamFromBedrock(stream, model) {
  return new ReadableStream({
    async start(controller) {
      let finishReason = "stop";
      let finalUsage = null;
      const toolUses = new Map();
      try {
        controller.enqueue(sse(openAIChunk(model, { role: "assistant" })));
        for await (const event of stream || []) {
          if (event.contentBlockStart?.start?.toolUse) {
            const index = event.contentBlockIndex ?? 0;
            const t = event.contentBlockStart.start.toolUse;
            const toolCall = { index, id: t.toolUseId, type: "function", function: { name: t.name, arguments: "" } };
            toolUses.set(index, toolCall);
            controller.enqueue(sse(openAIChunk(model, { tool_calls: [toolCall] })));
          }
          if (event.contentBlockDelta?.delta?.toolUse?.input) {
            const index = event.contentBlockIndex ?? 0;
            const existing = toolUses.get(index);
            const fragment = String(event.contentBlockDelta.delta.toolUse.input);
            if (existing) {
              existing.function.arguments += fragment;
            }
            controller.enqueue(sse(openAIChunk(model, { tool_calls: [{ index, id: existing?.id, type: "function", function: { name: existing?.function?.name, arguments: fragment } }] })));
          }
          if (event.contentBlockDelta?.delta?.text) {
            controller.enqueue(sse(openAIChunk(model, { content: event.contentBlockDelta.delta.text })));
          }
          if (event.messageStop?.stopReason) finishReason = convertStopReason(event.messageStop.stopReason);
          if (event.metadata?.usage) finalUsage = usageFromBedrock(event.metadata.usage);
        }
        controller.enqueue(sse(openAIChunk(model, {}, finishReason, finalUsage || undefined)));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.enqueue(sse(errorBody(error)));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    }
  });
}

// Errors the SDK's credential and token providers throw before any request is sent: an expired
// or missing SSO session, an unknown profile, a failing credential_process. They carry no HTTP
// status, and without this they would surface as a 502 upstream error instead of an auth one.
const CREDENTIAL_PROVIDER_ERRORS = new Set(["CredentialsProviderError", "TokenProviderError"]);

export function statusFromError(error) {
  if (CREDENTIAL_PROVIDER_ERRORS.has(error?.name)) return 401;
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

// A credential provider's own message can name local config paths, profile contents or
// credential_process output, so clients get this instead and the detail stays in the server log.
const CREDENTIAL_PROVIDER_MESSAGE =
  "AWS credentials for this connection could not be resolved. Check the profile, and for SSO " +
  "run `aws sso login` on the server.";

function errorBody(error, fallback = "Bedrock request failed") {
  const status = statusFromError(error);
  const isCredentialProviderError = CREDENTIAL_PROVIDER_ERRORS.has(error?.name);
  if (isCredentialProviderError) console.warn(`[bedrock] credential resolution failed: ${error.message}`);
  const message = isCredentialProviderError ? CREDENTIAL_PROVIDER_MESSAGE :
  isString(error?.message) && error.message ? error.message : fallback;
  return {
    error: {
      message,
      type: status === 429 ? "rate_limit_error" : status === 401 || status === 403 ? "auth_error" : "upstream_error",
      code: isString(error?.name) ? error.name : `HTTP_${status}`,
      status
    }
  };
}

export class BedrockExecutor extends BaseExecutor {
  constructor(clientFactory = null) {
    super("bedrock", PROVIDERS.bedrock || { format: "openai" });
    this.clientFactory = clientFactory;
  }

  buildUrl(model, stream, _urlIndex = 0, credentials = null) {
    return buildBedrockNativeConverseUrl(
      resolveBedrockRegion(credentials?.providerSpecificData),
      model,
      stream
    );
  }

  buildHeaders(credentials) {
    return {
      "Content-Type": "application/json",
      Authorization: credentials?.apiKey ? "Bearer ***" : ""
    };
  }

  /**
   * Build a client for this connection's credential mode: a Bedrock API key as a bearer token,
   * static AWS keys, or a named local AWS profile whose SSO session the SDK resolves and
   * refreshes on its own.
   *
   * @param {object} credentials - Connection credentials.
   * @returns {BedrockRuntimeClient}
   */
  createClient(credentials) {
    if (this.clientFactory) return this.clientFactory(credentials);
    return new BedrockRuntimeClient({
      region: resolveBedrockRegion(credentials?.providerSpecificData),
      ...buildBedrockClientAuth(credentials),
      maxAttempts: 1
    });
  }

  async execute({ model, body, stream, credentials, signal, requestContext = null }) {
    // OpenAI-shape body converts to Converse below; clamp its token fields first.
    body = this.clampCustomMaxOutput({ ...body }, requestContext);
    const url = this.buildUrl(model, stream, 0, credentials);
    const headers = this.buildHeaders(credentials);
    // No API-key precheck here: a connection may authenticate with an AWS profile or static AWS
    // keys instead, so what counts as "configured" is decided by createClient below. Its
    // credential errors carry status 401 and land in the same catch as any upstream failure.
    const transformedBody = openAIToBedrockConverse(model, body);
    try {
      const client = this.createClient(credentials);
      if (stream) {
        const output = await client.send(new ConverseStreamCommand(transformedBody), { abortSignal: signal || undefined });
        return {
          response: new Response(createOpenAIStreamFromBedrock(output.stream, model), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" }
          }),
          url,
          headers,
          transformedBody
        };
      }
      const output = await client.send(new ConverseCommand(transformedBody), { abortSignal: signal || undefined });
      return {
        response: new Response(JSON.stringify(openAICompletionFromConverse(output, model)), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }),
        url,
        headers,
        transformedBody
      };
    } catch (error) {
      const status = statusFromError(error);
      return {
        response: new Response(JSON.stringify(errorBody(error)), {
          status,
          headers: { "Content-Type": "application/json" }
        }),
        url,
        headers,
        transformedBody
      };
    }
  }
}

export default BedrockExecutor;