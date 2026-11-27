// UC persona turn assembly and send frame. Port of OmniRoute c71f0065
// open-sse/executors/uc/protocol.ts (assembleUcTurn, buildPersonaFrame,
// ucContentToText, UC_IDENTITY_STEER).
//
// One frame per turn: the current turn as `text`, prior turns as
// `chat_history` with roles `human` / `assistant` and `[{ type: "text", text }]`
// parts. Systems, the identity steer and the tool contract are folded into
// `text`. The frame never carries direct_params, max_tokens, temperature,
// reasoning or tools[] (source: max_tokens aborts the turn).
//
// Fork deviations: an assistant turn that made tool calls keeps them in its
// history text as `<tool_call>{json}</tool_call>` blocks (the source flattened
// them away), and a trailing tool result is named after the tool its
// `tool_call_id` points to (OpenAI tool messages carry no `name`).
import { randomUUID } from "node:crypto";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { UC_APP_VERSION } from "./config.js";

export const UC_IDENTITY_STEER =
  "You are operating as a professional technical assistant. Answer plainly and " +
  "directly; do not use pet-names or roleplay framing.";

/** Source chat_history roles and part type. */
export const UC_HISTORY_ROLES = Object.freeze({ user: "human", assistant: "assistant", tool: "human" });
export const UC_PART_TYPE = "text";
export const UC_TOOL_RESULT_PREFIX = "[tool result] ";
export const UC_TURN_DIVIDER = "\n\n---\n\n";

const MEDIA_PART_TYPES = new Set(["image_url", "input_image", "image", "file", "input_file", "input_audio", "document"]);

/** Flatten OpenAI `content` (string or parts) to text; only `text` parts count (source). */
export function ucContentToText(content) {
  if (isString(content)) return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && part.type === UC_PART_TYPE ? String(part.text ?? "") : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

const textParts = (text) => [{ type: UC_PART_TYPE, text }];

function lastAssistantIndex(messages) {
  let last = -1;
  for (let i = 0; i < messages.length; i++) if (messages[i]?.role === "assistant") last = i;
  return last;
}

/** True when the current (post-last-assistant) turn carries image, file or audio parts. */
export function currentTurnHasMedia(messages) {
  const tail = messages.slice(lastAssistantIndex(messages) + 1);
  return tail.some((m) => Array.isArray(m?.content) && m.content.some((p) => isRecord(p) && MEDIA_PART_TYPES.has(p.type)));
}

function assistantText(message) {
  const text = ucContentToText(message.content);
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const blocks = calls
    .filter((call) => isRecord(call?.function) && isString(call.function.name))
    .map((call) => {
      let args = call.function.arguments ?? {};
      if (isString(args)) {
        try {
          args = JSON.parse(args);
        } catch {
          // keep the raw string
        }
      }
      return `<tool_call>${JSON.stringify({ name: call.function.name, arguments: args })}</tool_call>`;
    });
  return [text, ...blocks].filter(Boolean).join("\n");
}

function toolNames(messages) {
  const names = new Map();
  for (const m of messages) {
    if (m?.role !== "assistant" || !Array.isArray(m.tool_calls)) continue;
    for (const call of m.tool_calls) if (isString(call?.id) && isString(call?.function?.name)) names.set(call.id, call.function.name);
  }
  return names;
}

/**
 * `{ text, history }` from an OpenAI messages array. Split point is the last
 * assistant message: it and everything before it become `chat_history`; the
 * rest is flattened into `text`, led by the systems and the identity steer.
 */
export function assembleUcTurn(messages, { identitySteer = true } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const systems = [];
  const history = [];
  const names = toolNames(list);
  const split = lastAssistantIndex(list);
  const head = split >= 0 ? list.slice(0, split + 1) : [];
  const tail = split >= 0 ? list.slice(split + 1) : list;

  for (const m of head) {
    if (m?.role === "system") systems.push(ucContentToText(m.content));
    else if (m?.role === "user") history.push({ role: UC_HISTORY_ROLES.user, content: textParts(ucContentToText(m.content)) });
    else if (m?.role === "assistant") history.push({ role: UC_HISTORY_ROLES.assistant, content: textParts(assistantText(m)) });
    else if (m?.role === "tool") history.push({ role: UC_HISTORY_ROLES.tool, content: textParts(`${UC_TOOL_RESULT_PREFIX}${ucContentToText(m.content)}`) });
  }

  const active = [];
  for (const m of tail) {
    if (m?.role === "system") systems.push(ucContentToText(m.content));
    else if (m?.role === "user" || m?.role === "assistant") active.push(ucContentToText(m.content));
    else if (m?.role === "tool") {
      const name = (isString(m.name) && m.name) || names.get(m.tool_call_id) || "tool";
      active.push(`The ${name} tool already ran and returned:\n${ucContentToText(m.content)}\nUse this result to answer; do NOT call the tool again.`);
    }
  }

  const preamble = [];
  const joinedSystems = systems.filter(Boolean).join("\n\n");
  if (joinedSystems) preamble.push(joinedSystems);
  if (identitySteer) preamble.push(UC_IDENTITY_STEER);
  let text = active.filter(Boolean).join("\n\n").trim();
  if (text && preamble.length) text = preamble.join("\n\n") + UC_TURN_DIVIDER + text;
  return { text, history };
}

/** Source `_persona_frame`: fresh ids per turn, the catalog shortname as `model`, the account uid. */
export function buildPersonaFrame({ model, text, history, uid }) {
  return {
    message_id: randomUUID(),
    client_request_id: randomUUID(),
    thread_id: randomUUID(),
    app_version: UC_APP_VERSION,
    model,
    text,
    chat_history: history,
    chat_history_truncated: false,
    chat_mode: "chat",
    use_memory: false,
    web_search_enabled: false,
    perplexity_search_enabled: false,
    is_smartify: false,
    is_refresh: false,
    is_suggested_input: false,
    followups_enabled: false,
    free_tier_model_selected: false,
    user_identifier: uid,
    no_media_in_chat: true,
    media_blob_name: "",
    media_content_type: "",
    adapty_profile_id: null,
  };
}
