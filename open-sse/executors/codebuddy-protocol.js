import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { OPENAI_FINISH, ROLE } from "../translator/schema/index.js";
import { createSseFrameReader, replaceSseFrameData } from "../utils/sseFrames.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
const AGENT_PATTERN = /you are claude code|claude.?code.{1,80}official.{1,80}cli|anthropic.{1,80}official.{1,80}cli|anxthxropic.{1,80}official.{1,80}cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s{0,80}=\s{0,80}(?:cli|vscode|jetbrains|gui)|claude.?code.{1,80}issues|give feedback.{1,80}claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;
// Limit identity matching work on unusually long lines; retain any unscanned suffix.
const MAX_IDENTITY_SCAN_LENGTH = 8192;
// Client metadata that fails CodeBuddy's channel check (400 / 11128) wherever it
// appears in a prompt. Only these fragments are replaced, never the whole line.
const CHANNEL_MARKER_PATTERN = /x-anthropic-billing-header|Main branch \(you will usually use this for PRs\):/g;
const CHANNEL_PLACEHOLDER = "[external-client-identity]";

function sanitizeInstructionText(text) {
  if (!text) return text;
  let replacedIdentity = false;
  const lines = text.split("\n").map((line) => {
    const scanned = line.slice(0, MAX_IDENTITY_SCAN_LENGTH);
    if (!AGENT_PATTERN.test(scanned)) return line;
    if (!replacedIdentity) {
      replacedIdentity = true;
      return NEUTRAL_PROMPT;
    }
    return scanned.replace(new RegExp(AGENT_PATTERN.source, "gi"), "") + line.slice(MAX_IDENTITY_SCAN_LENGTH);
  }).join("\n");
  return lines.replace(CHANNEL_MARKER_PATTERN, CHANNEL_PLACEHOLDER);
}

// Rewrite string or typed-block content, keeping the original value when nothing changed.
function sanitizeContent(content) {
  if (isString(content)) return sanitizeInstructionText(content);
  if (!Array.isArray(content)) return content;
  let changed = false;
  const blocks = content.map((block) => {
    if (!block || !isString(block.text)) return block;
    const text = sanitizeInstructionText(block.text);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? blocks : content;
}

/**
 * Remove external-client identity from system and developer messages. Matching
 * identity lines are neutralized while the rest of the client's rules and the
 * content shape stay intact. Conversation turns are never rewritten (#3823).
 */
export function sanitizeCodeBuddyMessages(provider, messages) {
  let sanitized = false;
  const result = messages.map((message) => {
    if (!message || ![ROLE.SYSTEM, ROLE.DEVELOPER].includes(message.role)) return message;
    const content = sanitizeContent(message.content);
    if (content === message.content) return message;
    sanitized = true;
    return { ...message, content };
  });
  if (sanitized) console.warn(`[${provider}] client identity text sanitized`);
  return result;
}

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

/**
 * Normalize CodeBuddy SSE streams using the shared WHATWG SSE frame reader
 * while retaining provider dispatch metadata (upstream 9router #2954, #5902).
 * Normalizes empty finish reasons to null, drops empty function_call shells,
 * suppresses duplicate [DONE] sentinels, and emits one terminal finish chunk
 * before [DONE] when a clean turn ends with open choices and no upstream error.
 */
export function normalizeCodeBuddyResponse(result) {
  const response = result.response;
  if (!response?.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return result;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = createSseFrameReader();
  const openChoices = new Map();
  const finishedChoices = new Set();
  let lastChunk = null;
  let usage = undefined;
  let errorSeen = false;
  let doneSeen = false;

  const emitFrame = (frame, controller) => {
    if (doneSeen) return;
    const wire = frame.wire ?? `${frame.raw}\n\n`;
    if (frame.eventName?.trim() === "error") errorSeen = true;
    if (!frame.hasData) {
      controller.enqueue(encoder.encode(wire));
      return;
    }
    const payload = frame.data.trim();
    if (payload === "[DONE]") {
      doneSeen = true;
      if (!errorSeen && openChoices.size > 0 && lastChunk) {
        const { id, model, created } = lastChunk;
        const choices = Array.from(openChoices, ([index, toolCallSeen]) => ({
          index,
          delta: {},
          finish_reason: toolCallSeen ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP,
        }));
        const terminal = {
          id,
          model,
          created,
          object: "chat.completion.chunk",
          choices,
          ...(usage !== undefined ? { usage } : null),
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(terminal)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      return;
    }
    try {
      const chunk = JSON.parse(payload);
      if (chunk?.error || chunk?.type === "error") errorSeen = true;
      if (chunk?.usage) usage = chunk.usage;
      if (Array.isArray(chunk?.choices)) {
        let changed = false;
        chunk.choices.forEach((choice, position) => {
          if (!choice || typeof choice !== "object") return;
          const index = choice.index ?? position;
          if (choice.finish_reason === "") {
            choice.finish_reason = null;
            changed = true;
          }
          const call = choice.delta?.function_call;
          if (call && !call.name && !call.arguments) {
            delete choice.delta.function_call;
            changed = true;
          }
          if (choice.finish_reason) {
            finishedChoices.add(index);
            openChoices.delete(index);
          } else if (choice.delta && typeof choice.delta === "object" && Object.keys(choice.delta).length > 0 && !finishedChoices.has(index)) {
            const hasTool = Boolean(choice.delta.tool_calls?.length);
            openChoices.set(index, hasTool || openChoices.get(index) === true);
            lastChunk = chunk;
          }
        });
        controller.enqueue(encoder.encode(changed ? replaceSseFrameData(frame, JSON.stringify(chunk)) : wire));
        return;
      }
    } catch {
      // Leave parsing of other upstream frames to the downstream SSE handler.
    }
    controller.enqueue(encoder.encode(wire));
  };

  const transform = new TransformStream({
    transform(bytes, controller) {
      for (const frame of reader.push(decoder.decode(bytes, { stream: true }))) {
        emitFrame(frame, controller);
      }
    },
    flush(controller) {
      const tail = decoder.decode();
      if (tail) {
        for (const frame of reader.push(tail)) emitFrame(frame, controller);
      }
      for (const frame of reader.flush()) emitFrame(frame, controller);
    },
  });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  const normalized = new Response(response.body.pipeThrough(transform), { status: response.status, statusText: response.statusText, headers });
  transferProviderAttemptDispatch(response, normalized);
  return { ...result, response: normalized };
}
