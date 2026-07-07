import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import {
  buildBedrockNativeConverseUrl,
  resolveBedrockRegion,
} from "../config/bedrock.js";

const encoder = new TextEncoder();

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toText(value) {
  if (typeof value === "string") return value;
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
  if (typeof value !== "string") return null;
  const match = value.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i);
  if (!match) return null;
  return { format: match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase(), data: match[2] };
}

function textBlocksFromContent(content) {
  if (typeof content === "string") return content.trim() ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part.trim()) blocks.push({ text: part });
      continue;
    }
    const p = asRecord(part);
    const type = typeof p.type === "string" ? p.type : "";
    if ((type === "text" || type === "input_text") && typeof p.text === "string") {
      if (p.text.trim()) blocks.push({ text: p.text });
      continue;
    }
    if (type === "image_url" || type === "input_image") {
      const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url || p.image_url;
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        throw new Error(`Bedrock does not support remote image URLs; inline the image as a data URI or use a provider that prefetches images (${url.slice(0, 60)})`);
      }
      const image = stripDataUrlPrefix(url);
      if (image) {
        blocks.push({
          image: {
            format: image.format,
            source: { bytes: Uint8Array.from(Buffer.from(image.data, "base64")) },
          },
        });
      }
      continue;
    }
    if (type === "tool_result" && typeof p.tool_use_id === "string") {
      blocks.push({
        toolResult: {
          toolUseId: p.tool_use_id,
          content: [{ text: toText(p.content) || " " }],
          status: p.is_error ? "error" : "success",
        },
      });
    }
  }
  return blocks;
}

function systemBlocksFromOpenAI(messages) {
  return messages
    .filter((message) => message?.role === "system" || message?.role === "developer")
    .map((message) =>
      textBlocksFromContent(message.content)
        .map((block) => block.text || "")
        .filter(Boolean)
        .join("\n")
    )
    .filter((text) => text.trim())
    .map((text) => ({ text }));
}

function toolResultContentFromMessage(message) {
  if (typeof message.content === "string") return [{ text: message.content || " " }];
  if (!Array.isArray(message.content)) return [{ text: toText(message.content) || " " }];
  const result = [];
  for (const part of message.content) {
    if (typeof part === "string") result.push({ text: part || " " });
    else if (typeof part?.text === "string") result.push({ text: part.text || " " });
    else if (part?.json !== undefined) result.push({ json: part.json });
    else if (part?.content !== undefined) result.push({ text: toText(part.content) || " " });
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
            status: "success",
          },
        })),
      };
    }
    return group;
  });
}

function messagesFromOpenAI(messages) {
  const converted = [];
  for (const message of groupToolResults(messages)) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "system" || message.role === "developer") continue;
    if (message.role === "tool") {
      converted.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: message.tool_call_id || `toolu_${randomUUID()}`,
              content: toolResultContentFromMessage(message),
              status: "success",
            },
          },
        ],
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
        input = typeof fn.arguments === "string" && fn.arguments.trim() ? JSON.parse(fn.arguments) : {};
      } catch {
        input = { arguments: fn.arguments };
      }
      content.push({
        toolUse: {
          toolUseId: call.id || `toolu_${randomUUID()}`,
          name: typeof fn.name === "string" && fn.name ? fn.name : "unknown_tool",
          input,
        },
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
    const name = typeof fn.name === "string" ? fn.name.trim() : "";
    if (!name) continue;
    bedrockTools.push({
      toolSpec: {
        name,
        description: typeof fn.description === "string" ? fn.description : undefined,
        inputSchema: { json: asRecord(fn.parameters) },
      },
    });
  }
  if (bedrockTools.length === 0) return undefined;
  if (toolChoice === "none") return undefined;
  const config = { tools: bedrockTools };
  if (toolChoice === "required") config.toolChoice = { any: {} };
  else if (toolChoice === "auto") config.toolChoice = { auto: {} };
  else if (toolChoice && typeof toolChoice === "object") {
    const name = asRecord(toolChoice.function).name;
    if (typeof name === "string" && name) config.toolChoice = { tool: { name } };
  }
  return config;
}

export function openAIToBedrockConverse(model, body) {
  const request = asRecord(body);
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const inferenceConfig = {};
  const maxTokens = request.max_tokens ?? request.max_completion_tokens;
  if (typeof maxTokens === "number") inferenceConfig.maxTokens = Math.max(1, Math.floor(maxTokens));
  if (typeof request.temperature === "number") inferenceConfig.temperature = request.temperature;
  if (typeof request.top_p === "number") inferenceConfig.topP = request.top_p;
  if (Array.isArray(request.stop)) inferenceConfig.stopSequences = request.stop.filter(Boolean);
  else if (typeof request.stop === "string" && request.stop) inferenceConfig.stopSequences = [request.stop];

  const payload = { modelId: model, messages: messagesFromOpenAI(messages) };
  const system = systemBlocksFromOpenAI(messages);
  if (system.length > 0) payload.system = system;
  if (Object.keys(inferenceConfig).length > 0) payload.inferenceConfig = inferenceConfig;
  const toolConfig = toolConfigFromOpenAI(request.tools, request.tool_choice);
  if (toolConfig) payload.toolConfig = toolConfig;
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

function contentBlocksToOpenAIMessage(blocks) {
  const text = [];
  const toolCalls = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (typeof block?.text === "string") text.push(block.text);
    if (block?.toolUse) {
      toolCalls.push({
        id: block.toolUse.toolUseId,
        type: "function",
        function: { name: block.toolUse.name, arguments: JSON.stringify(block.toolUse.input || {}) },
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
        finish_reason: convertStopReason(output?.stopReason),
      },
    ],
    usage: usageFromBedrock(output?.usage),
  };
}

function openAIChunk(model, delta, finishReason = null, usage = undefined) {
  const chunk = {
    id: `chatcmpl-bedrock-${model}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
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
    },
  });
}

function statusFromError(error) {
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function errorBody(error, fallback = "Bedrock request failed") {
  const status = statusFromError(error);
  const message = typeof error?.message === "string" && error.message ? error.message : fallback;
  return {
    error: {
      message,
      type: status === 429 ? "rate_limit_error" : status === 401 || status === 403 ? "auth_error" : "upstream_error",
      code: typeof error?.name === "string" ? error.name : `HTTP_${status}`,
      status,
    },
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
      Authorization: credentials?.apiKey ? "Bearer ***" : "",
    };
  }

  createClient(credentials) {
    if (this.clientFactory) return this.clientFactory(credentials);
    return new BedrockRuntimeClient({
      region: resolveBedrockRegion(credentials?.providerSpecificData),
      token: { token: credentials.apiKey },
      authSchemePreference: ["httpBearerAuth"],
      maxAttempts: 1,
    });
  }

  async execute({ model, body, stream, credentials, signal }) {
    const url = this.buildUrl(model, stream, 0, credentials);
    const headers = this.buildHeaders(credentials);
    if (!credentials?.apiKey) {
      return {
        response: new Response(JSON.stringify(errorBody({ name: "MissingCredentials", message: "Missing Bedrock API key", status: 401 })), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
        url,
        headers,
        transformedBody: null,
      };
    }

    const transformedBody = openAIToBedrockConverse(model, body);
    try {
      const client = this.createClient(credentials);
      if (stream) {
        const output = await client.send(new ConverseStreamCommand(transformedBody), { abortSignal: signal || undefined });
        return {
          response: new Response(createOpenAIStreamFromBedrock(output.stream, model), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
          url,
          headers,
          transformedBody,
        };
      }
      const output = await client.send(new ConverseCommand(transformedBody), { abortSignal: signal || undefined });
      return {
        response: new Response(JSON.stringify(openAICompletionFromConverse(output, model)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        url,
        headers,
        transformedBody,
      };
    } catch (error) {
      const status = statusFromError(error);
      return {
        response: new Response(JSON.stringify(errorBody(error)), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
        url,
        headers,
        transformedBody,
      };
    }
  }
}

export default BedrockExecutor;
