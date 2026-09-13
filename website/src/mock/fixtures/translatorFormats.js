// Lightweight request translation between the dialects shown on the
// translator page. It mirrors the shape of open-sse/translator output for the
// common cases (text, images, tools, system prompts, thinking) without pulling
// the server-side executors into the browser bundle.

import { randomId } from "./playgroundReplies.js";

// Provider wire formats and upstream endpoints (open-sse/providers/registry).
export const PROVIDER_TARGETS = Object.freeze({
  claude: { format: "claude", url: "https://api.anthropic.com/v1/messages?beta=true" },
  anthropic: { format: "claude", url: "https://api.anthropic.com/v1/messages" },
  codex: { format: "openai-responses", url: "https://chatgpt.com/backend-api/codex/responses" },
  "gemini-cli": { format: "gemini-cli", url: "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse" },
  antigravity: { format: "antigravity", url: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse" },
  github: { format: "openai", url: "https://api.githubcopilot.com/chat/completions" },
  kiro: { format: "kiro", url: "https://runtime.us-east-1.kiro.dev/generateAssistantResponse" },
  cursor: { format: "cursor", url: "https://api2.cursor.sh/aiserver.v1.ChatService/StreamUnifiedChatWithTools" },
  groq: { format: "openai", url: "https://api.groq.com/openai/v1/chat/completions" },
  openrouter: { format: "openai", url: "https://openrouter.ai/api/v1/chat/completions" },
  deepseek: { format: "openai", url: "https://api.deepseek.com/chat/completions" },
  "ollama-local": { format: "ollama", url: "http://localhost:11434/api/chat" },
  "openai-compatible-ravenhill": { format: "openai", url: "https://llm.ravenhill.internal/v1/chat/completions" },
});

export function targetFor(provider) {
  return PROVIDER_TARGETS[provider] || { format: "openai", url: "https://api.openai.com/v1/chat/completions" };
}

/** Same heuristics as open-sse/services/provider.js detectFormat. */
export function detectFormat(body) {
  if (!body || typeof body !== "object") return "openai";
  if (body.input && (Array.isArray(body.input) || typeof body.input === "string") && !body.messages) return "openai-responses";
  if (body.request?.contents && body.userAgent === "antigravity") return "antigravity";
  if (Array.isArray(body.contents)) return "gemini";
  if (body.stream_options || body.response_format || body.n !== undefined || body.user) return "openai";
  const first = Array.isArray(body.messages) ? body.messages[0] : null;
  const firstPart = Array.isArray(first?.content) ? first.content[0] : null;
  if (body.system !== undefined || body.anthropic_version || body.thinking || (["text", "image", "tool_use", "tool_result"].includes(firstPart?.type) && body.max_tokens)) {
    return "claude";
  }
  return "openai";
}

const joinText = (parts) => (Array.isArray(parts) ? parts.map((part) => part?.text || "").filter(Boolean).join("\n") : String(parts ?? ""));
const EFFORT_BUDGET = { low: 4096, medium: 16000, high: 32000 };

function budgetToEffort(budget) {
  if (!budget) return undefined;
  return budget <= 4096 ? "low" : budget <= 16000 ? "medium" : "high";
}

// ---- source -> OpenAI -------------------------------------------------------

function claudeToOpenAI(body) {
  const messages = body.system ? [{ role: "system", content: joinText(body.system) }] : [];
  for (const message of body.messages || []) {
    if (!Array.isArray(message.content)) {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    const toolResults = message.content.filter((part) => part.type === "tool_result");
    toolResults.forEach((part) => messages.push({ role: "tool", tool_call_id: part.tool_use_id, content: joinText(part.content) }));
    const toolUses = message.content.filter((part) => part.type === "tool_use");
    const parts = message.content
      .filter((part) => part.type === "text" || part.type === "image")
      .map((part) =>
        part.type === "text"
          ? { type: "text", text: part.text }
          : { type: "image_url", image_url: { url: part.source?.type === "base64" ? `data:${part.source.media_type};base64,${part.source.data}` : part.source?.url } },
      );
    if (!parts.length && !toolUses.length) continue;
    messages.push({
      role: message.role,
      content: parts.every((part) => part.type === "text") ? parts.map((part) => part.text).join("\n") : parts,
      ...(toolUses.length ? { tool_calls: toolUses.map((part) => ({ id: part.id, type: "function", function: { name: part.name, arguments: JSON.stringify(part.input || {}) } })) } : null),
    });
  }
  return {
    model: body.model,
    messages,
    ...(body.max_tokens ? { max_tokens: body.max_tokens } : null),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : null),
    ...(body.tools ? { tools: body.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } })) } : null),
    ...(body.thinking?.budget_tokens ? { reasoning_effort: budgetToEffort(body.thinking.budget_tokens) } : null),
    stream: body.stream !== false,
    ...(body.stream !== false ? { stream_options: { include_usage: true } } : null),
  };
}

function geminiToOpenAI(body) {
  const inner = body.request || body;
  const system = inner.systemInstruction ? [{ role: "system", content: joinText(inner.systemInstruction.parts) }] : [];
  const messages = (inner.contents || []).map((content) => ({ role: content.role === "model" ? "assistant" : "user", content: joinText(content.parts) }));
  const declarations = (inner.tools || []).flatMap((tool) => tool.functionDeclarations || []);
  return {
    model: body.model,
    messages: [...system, ...messages],
    ...(inner.generationConfig?.maxOutputTokens ? { max_tokens: inner.generationConfig.maxOutputTokens } : null),
    ...(inner.generationConfig?.temperature !== undefined ? { temperature: inner.generationConfig.temperature } : null),
    ...(declarations.length ? { tools: declarations.map((fn) => ({ type: "function", function: { name: fn.name, description: fn.description, parameters: fn.parameters } })) } : null),
    stream: true,
  };
}

function responsesToOpenAI(body) {
  const messages = body.instructions ? [{ role: "system", content: body.instructions }] : [];
  const items = typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input || [];
  for (const item of items) {
    if (item.type === "function_call") messages.push({ role: "assistant", content: null, tool_calls: [{ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } }] });
    else if (item.type === "function_call_output") messages.push({ role: "tool", tool_call_id: item.call_id, content: String(item.output) });
    else if (item.role) messages.push({ role: item.role === "developer" ? "system" : item.role, content: typeof item.content === "string" ? item.content : joinText(item.content) });
  }
  return {
    model: body.model,
    messages,
    ...(body.max_output_tokens ? { max_tokens: body.max_output_tokens } : null),
    ...(body.tools ? { tools: body.tools.filter((tool) => tool.type === "function").map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : null),
    ...(body.reasoning?.effort ? { reasoning_effort: body.reasoning.effort } : null),
    stream: body.stream !== false,
  };
}

export function toOpenAI(sourceFormat, body, model) {
  const converted =
    sourceFormat === "claude" ? claudeToOpenAI(body)
      : sourceFormat === "gemini" || sourceFormat === "antigravity" ? geminiToOpenAI(body)
        : sourceFormat === "openai-responses" ? responsesToOpenAI(body)
          : { ...body };
  return { ...converted, model: model || converted.model };
}

// ---- OpenAI -> target -------------------------------------------------------

const systemOf = (body) => (body.messages || []).filter((message) => message.role === "system").map((message) => joinText(message.content)).join("\n");
const chatOf = (body) => (body.messages || []).filter((message) => message.role !== "system");
const textOf = (content) => (typeof content === "string" ? content : joinText(content));
const toolsOf = (body) => (body.tools || []).map((tool) => tool.function || tool);

function openaiToClaude(body, model) {
  const system = systemOf(body);
  const messages = chatOf(body).map((message) => {
    if (message.role === "tool") return { role: "user", content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: textOf(message.content) }] };
    const text = textOf(message.content);
    const parts = [
      ...(text ? [{ type: "text", text }] : []),
      ...(message.tool_calls || []).map((call) => ({ type: "tool_use", id: call.id, name: call.function?.name, input: JSON.parse(call.function?.arguments || "{}") })),
    ];
    return { role: message.role, content: parts };
  });
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (lastUser?.content?.length) lastUser.content[lastUser.content.length - 1].cache_control = { type: "ephemeral" };
  const tools = toolsOf(body);
  return {
    model,
    max_tokens: body.max_tokens || 32000,
    ...(system ? { system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] } : null),
    messages,
    ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : null),
    ...(body.reasoning_effort ? { thinking: { type: "enabled", budget_tokens: EFFORT_BUDGET[body.reasoning_effort] || 16000 } } : null),
    metadata: { user_id: "user_demo_account__session_" + randomId("", 12) },
    stream: body.stream !== false,
  };
}

function openaiToGeminiRequest(body) {
  const system = systemOf(body);
  const tools = toolsOf(body);
  return {
    contents: chatOf(body).map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: textOf(message.content) }] })),
    ...(system ? { systemInstruction: { role: "user", parts: [{ text: system }] } } : null),
    generationConfig: {
      maxOutputTokens: body.max_tokens || 65536,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : null),
      ...(body.reasoning_effort ? { thinkingConfig: { thinkingBudget: EFFORT_BUDGET[body.reasoning_effort] || 16000, includeThoughts: true } } : null),
    },
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }] } : null),
  };
}

function openaiToResponses(body, model) {
  const tools = toolsOf(body);
  return {
    model,
    instructions: systemOf(body) || "You are a coding agent running in the Codex CLI.",
    input: chatOf(body).map((message) => ({
      type: "message",
      role: message.role === "tool" ? "user" : message.role,
      content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: textOf(message.content) }],
    })),
    ...(tools.length ? { tools: tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })) } : null),
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: { effort: body.reasoning_effort || "medium", summary: "auto" },
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: randomId("", 16),
  };
}

function openaiToKiro(body, model) {
  const chat = chatOf(body);
  const last = chat[chat.length - 1];
  const system = systemOf(body);
  return {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: randomId("conv-", 20),
      currentMessage: { userInputMessage: { content: `${system ? `${system}\n\n` : ""}${textOf(last?.content)}`, modelId: model, origin: "AI_EDITOR" } },
      history: chat.slice(0, -1).map((message) =>
        message.role === "assistant" ? { assistantResponseMessage: { content: textOf(message.content) } } : { userInputMessage: { content: textOf(message.content), modelId: model, origin: "AI_EDITOR" } },
      ),
    },
  };
}

export function fromOpenAI(targetFormat, body, model) {
  const { provider: _provider, model: _model, ...clean } = body;
  switch (targetFormat) {
    case "claude":
      return openaiToClaude(clean, model);
    case "gemini":
      return openaiToGeminiRequest(clean);
    case "gemini-cli":
      return { model, project: "erebor-forge-4821", request: openaiToGeminiRequest(clean) };
    case "antigravity":
      return { project: "erebor-forge-4821", model, userAgent: "antigravity", requestId: randomId("agent-", 16), request: openaiToGeminiRequest(clean) };
    case "openai-responses":
      return openaiToResponses(clean, model);
    case "kiro":
      return openaiToKiro(clean, model);
    case "ollama":
      return { model, messages: clean.messages, stream: clean.stream !== false, options: { num_predict: clean.max_tokens || 4096, ...(clean.temperature !== undefined ? { temperature: clean.temperature } : null) } };
    default:
      return { ...clean, model };
  }
}

export function headersFor(provider, stream = true) {
  const target = targetFor(provider);
  const auth = target.format === "claude" && provider === "anthropic" ? { "x-api-key": "sk-ant-api03-••••••••" } : { Authorization: "Bearer ••••••••" };
  return {
    "Content-Type": "application/json",
    ...(stream ? { Accept: "text/event-stream" } : null),
    ...auth,
    ...(target.format === "claude" ? { "anthropic-version": "2023-06-01", "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14" } : null),
    ...(provider === "codex" ? { "chatgpt-account-id": "acct_••••", originator: "codex_cli_rs", session_id: randomId("", 16) } : null),
    ...(provider === "github" ? { "Copilot-Integration-Id": "vscode-chat", "Editor-Version": "vscode/1.104.0" } : null),
  };
}
