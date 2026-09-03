// Claude helper functions for translator
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { ROLE, CLAUDE_BLOCK } from "../schema/index.js";
import { adjustMaxTokens } from "./maxTokens.js";
import { applyCloaking } from "../../utils/claudeCloaking.js";
import { resolveSessionId } from "../../utils/sessionManager.js";
import { isValidClaudeSignature } from "../../utils/claudeSignature.js";
import { PROVIDERS } from "../../providers/index.js";
import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { DEFAULT_MAX_TOKENS } from "../../config/runtimeConfig.js";
import { isObject, isString, runtimeTypeName } from "../../../src/shared/utils/typeChecks.js";
import { applyAssistantPrefillPolicy } from "../concerns/assistantPrefillPolicy.js";

const CACHE_CONTROL_5M = { type: "ephemeral" };
const CACHE_CONTROL_1H = { type: "ephemeral", ttl: "1h" };

function lastCacheableToolIndex(tools) {
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i]?.defer_loading !== true) return i;
  }
  return -1;
}

const HOISTABLE_SYSTEM_BLOCKS = new Set([CLAUDE_BLOCK.TEXT]);
const USER_SYSTEM_FOLDABLE_BLOCKS = new Set([
CLAUDE_BLOCK.TEXT,
CLAUDE_BLOCK.IMAGE,
CLAUDE_BLOCK.DOCUMENT,
CLAUDE_BLOCK.TOOL_RESULT,
CLAUDE_BLOCK.SEARCH_RESULT]
);

// Put a 5m breakpoint on the last cache-eligible block of a message.
// thinking/redacted_thinking blocks do not accept cache_control.
function markLastCacheableBlock(msg) {
  if (!Array.isArray(msg?.content)) return false;
  for (let i = msg.content.length - 1; i >= 0; i--) {
    const block = msg.content[i];
    if (!isObject(block) || block === null) continue;
    if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) continue;
    block.cache_control = { ...CACHE_CONTROL_5M };
    return true;
  }
  return false;
}

// Re-anchor cache breakpoints on a Claude passthrough body after transformations.
export function anchorClaudeCache(body) {
  if (!body || !isObject(body)) return body;

  if (Array.isArray(body.system)) {
    const last = body.system.length - 1;
    body.system.forEach((block, i) => {
      if (!isObject(block) || block === null) return;
      if (i === last) block.cache_control = { ...CACHE_CONTROL_1H };else
      delete block.cache_control;
    });
  }

  if (Array.isArray(body.tools)) {
    const last = lastCacheableToolIndex(body.tools);
    body.tools.forEach((tool, i) => {
      if (i === last) tool.cache_control = { ...CACHE_CONTROL_1H };else
      delete tool.cache_control;
    });
  }

  if (Array.isArray(body.messages)) {
    let anchored = null;
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      delete msg.cache_control;
      if (isString(msg.content)) {
        msg.content = msg.content ? [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }] : [];
      }
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {if (block && isObject(block)) delete block.cache_control;}
      if (anchored || msg.role !== ROLE.ASSISTANT) continue;
      anchored = markLastCacheableBlock(msg);
    }
    if (!anchored) {
      for (let i = body.messages.length - 1; i >= 0 && !anchored; i--) {
        anchored = markLastCacheableBlock(body.messages[i]);
      }
    }
  }

  return body;
}

// Check if message has valid non-empty content
export function hasValidContent(msg) {
  if (isString(msg.content) && msg.content.trim()) return true;
  if (Array.isArray(msg.content)) {
    return msg.content.some((block) =>
    block.type === CLAUDE_BLOCK.TEXT && block.text?.trim() ||
    block.type === CLAUDE_BLOCK.TOOL_USE ||
    block.type === CLAUDE_BLOCK.TOOL_RESULT ||
    block.type === CLAUDE_BLOCK.SERVER_TOOL_USE && !hasForeignClaudeServerToolId(block) ||
    block.type === CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT ||
    block.type === CLAUDE_BLOCK.IMAGE ||
    block.type === CLAUDE_BLOCK.DOCUMENT ||
    block.type === CLAUDE_BLOCK.THINKING ||
    block.type === CLAUDE_BLOCK.REDACTED_THINKING
    );
  }
  return false;
}

// Fix tool_use/tool_result ordering for Claude API
// 1. Assistant message with tool_use: remove text AFTER tool_use (Claude doesn't allow)
// 2. Merge consecutive same-role messages
export function fixToolUseOrdering(messages) {
  if (messages.length <= 1) return messages;

  // Pass 1: Fix assistant messages with tool_use - remove text after tool_use
  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      const hasToolUse = msg.content.some((b) => b.type === CLAUDE_BLOCK.TOOL_USE);
      if (hasToolUse) {
        // Keep only: thinking blocks + tool_use blocks (remove text blocks after tool_use)
        const newContent = [];
        let foundToolUse = false;

        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            foundToolUse = true;
            newContent.push(block);
          } else if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
            newContent.push(block);
          } else if (!foundToolUse) {
            // Keep text blocks BEFORE tool_use
            newContent.push(block);
          }
          // Skip text blocks AFTER tool_use
        }

        msg.content = newContent;
      }
    }
  }

  // Pass 2: Merge consecutive same-role messages
  const merged = [];

  for (const msg of messages) {
    const last = merged[merged.length - 1];

    if (last && last.role === msg.role) {
      // Merge content arrays
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: CLAUDE_BLOCK.TEXT, text: last.content }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];

      // Put tool_result first, then other content
      const toolResults = [...lastContent.filter((b) => b.type === CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter((b) => b.type === CLAUDE_BLOCK.TOOL_RESULT)];
      const otherContent = [...lastContent.filter((b) => b.type !== CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter((b) => b.type !== CLAUDE_BLOCK.TOOL_RESULT)];

      last.content = [...toolResults, ...otherContent];
    } else {
      // Ensure content is array
      const content = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];
      merged.push({ role: msg.role, content: [...content] });
    }
  }

  // Pass 3: Claude accepts a tool_result only for a tool_use in the IMMEDIATELY
  // previous assistant message. Compacted cross-model history can retain an
  // output after dropping its call; keep that output as user text instead of
  // sending an invalid structured reference or discarding useful context (#2663).
  for (let i = 0; i < merged.length; i++) {
    const msg = merged[i];
    if (msg.role !== ROLE.USER || !Array.isArray(msg.content)) continue;

    const previous = merged[i - 1];
    const regularToolIds = new Set();
    const serverToolIds = new Set();
    if (previous?.role === ROLE.ASSISTANT && Array.isArray(previous.content)) {
      for (const block of previous.content) {
        if (!block.id) continue;
        if (block.type === CLAUDE_BLOCK.TOOL_USE) regularToolIds.add(block.id);
        if (block.type === CLAUDE_BLOCK.SERVER_TOOL_USE) serverToolIds.add(block.id);
      }
    }
    const pairedById = new Map();
    const otherContent = [];

    for (const block of msg.content) {
      if (block.type === CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT) {
        if (serverToolIds.has(block.tool_use_id)) otherContent.push(block);
        else otherContent.push(demoteUnpairedToolResult(block));
        continue;
      }
      if (block.type !== CLAUDE_BLOCK.TOOL_RESULT) {
        otherContent.push(block);
        continue;
      }
      if (serverToolIds.has(block.tool_use_id)) {
        otherContent.push(block);
        continue;
      }
      if (regularToolIds.has(block.tool_use_id) && !pairedById.has(block.tool_use_id)) {
        pairedById.set(block.tool_use_id, block);
        continue;
      }
      otherContent.push(demoteUnpairedToolResult(block));
    }

    if (pairedById.size === 0 && !msg.content.some((block) =>
      block.type === CLAUDE_BLOCK.TOOL_RESULT || block.type === CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT
    )) continue;
    const pairedResults = [...regularToolIds].map((id) =>
    pairedById.get(id) || { type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: id, content: "" }
    );
    msg.content = [...pairedResults, ...otherContent];
  }

  return merged;
}

function demoteUnpairedToolResult(block) {
  let serialized;
  try {
    serialized = isString(block.content) ? block.content : JSON.stringify(block.content ?? "");
  } catch {
    serialized = String(block.content ?? "");
  }
  const text = {
    type: CLAUDE_BLOCK.TEXT,
    text: `[Unpaired tool result ${block.tool_use_id || "unknown"}]\n${serialized ?? ""}`
  };
  if (block.cache_control) text.cache_control = block.cache_control;
  return text;
}

// Models that reject thinking.type "adaptive" + output_config.effort (Opus 4.5+/Sonnet 4.6+ only)
const ADAPTIVE_THINKING_UNSUPPORTED = /haiku/i;

// Adaptive-thinking models (Fable/Mythos) do not support unsigned or default-
// signature historical thinking blocks and must never receive synthetic placeholders.
function isAdaptiveThinkingModel(model) {
  return /claude-(fable|mythos)/i.test(model || "");
}

const CLAUDE_PROVIDER_MODEL_PREFIXES = ["cc/", "claude/"];

/**
 * Strip routing-only Claude provider prefixes from nested server-tool models
 * while preserving every other tool field for Anthropic dispatch.
 */
function normalizeClaudeServerToolModels(tools) {
  if (!Array.isArray(tools)) return;

  for (const tool of tools) {
    if (!tool || !isObject(tool) || !isString(tool.model)) continue;
    const prefix = CLAUDE_PROVIDER_MODEL_PREFIXES.find((candidate) => tool.model.startsWith(candidate));
    if (prefix) tool.model = tool.model.slice(prefix.length);
  }
}

function handlesThinkingBlocks(provider) {
  return provider === "claude" || provider?.startsWith("anthropic-compatible") || provider === "deepseek";
}

function buildThinkingPlaceholder(provider) {
  const block = {
    type: CLAUDE_BLOCK.THINKING,
    thinking: "."
  };

  // DeepSeek's Anthropic-compatible endpoint requires a thinking block in
  // thinking mode, but it does not need Anthropic's signed-thinking fallback.
  if (provider !== "deepseek") {
    block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
  }

  return block;
}

/**
 * Keep Anthropic's strict token contract valid after unified thinking has
 * applied a budget. Shared by translated requests and native Claude
 * passthrough so neither path can send `budget_tokens >= max_tokens`.
 */
export function reconcileClaudeThinkingBudget(body, provider = "claude", customMaxOutput = null) {
  if (!body || !isObject(body) || !body.max_tokens) return body;

  // Custom-model maxOutput overrides the static catalog ceiling; the thinking
  // budget is then fitted inside the already-clamped cap.
  const ceiling = (Number.isFinite(customMaxOutput) && customMaxOutput > 0 ? customMaxOutput : null) ?? (
  getCapabilitiesForModel(provider, body.model).maxOutput || DEFAULT_MAX_TOKENS);
  if (body.max_tokens > ceiling) body.max_tokens = ceiling;

  if (
  body.thinking?.type === "enabled" &&
  body.thinking.budget_tokens &&
  body.thinking.budget_tokens >= body.max_tokens)
  {
    body.max_tokens = Math.min(body.thinking.budget_tokens + 1024, ceiling);
    if (body.thinking.budget_tokens >= body.max_tokens) {
      // Anthropic requires budget_tokens strictly below max_tokens. The 1024
      // floor assumes a roomy ceiling; a small custom maxOutput may not fit
      // it, so fall back to leaving at least 1 output token, and disable
      // thinking entirely when even that can't fit.
      const fitted = Math.min(Math.max(1024, body.max_tokens - 1024), body.max_tokens - 1);
      if (fitted >= 1) {
        body.thinking.budget_tokens = fitted;
      } else {
        delete body.thinking;
      }
    }
  }

  return body;
}
const CLAUDE_SERVER_TOOL_USE_ID = /^srvtoolu_[a-zA-Z0-9_]+$/;

// Anthropic server_tool_use only; ordinary tool_use IDs must never use this predicate.
function hasForeignClaudeServerToolId(block) {
  return block?.type === CLAUDE_BLOCK.SERVER_TOOL_USE &&
  (!isString(block.id) || !CLAUDE_SERVER_TOOL_USE_ID.test(block.id));
}

function serverToolIdKey(id) {
  if (id === null) return "null";
  return isObject(id) ? "object" : `${runtimeTypeName(id)}:${String(id)}`;
}

// Normalize a native Claude passthrough body to match Anthropic Messages API spec.
// Newer Cowork/Claude Code clients emit beta-only shapes that OAuth endpoints reject:
// 1. thinking.type "adaptive" → unsupported on Haiku
// 2. output_config.effort → unsupported on Haiku
// 3. role "system" messages (mid-conversation-system beta) → only top-level system is allowed
// 4. server_tool_use blocks carrying foreign IDs → rejected outright
export function normalizeClaudePassthrough(body, model = "", provider = "claude", customMaxOutput = null, options = null) {
  if (!body || !isObject(body)) return body;

  // 1. Downgrade adaptive thinking for models that don't support it
  if (body.thinking?.type === "adaptive" && ADAPTIVE_THINKING_UNSUPPORTED.test(model)) {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }

  // 2. Strip effort param for models that don't support it (keep other output_config fields)
  if (ADAPTIVE_THINKING_UNSUPPORTED.test(model) && body.output_config?.effort != null) {
    delete body.output_config.effort;
    if (Object.keys(body.output_config).length === 0) delete body.output_config;
  }

  if (Array.isArray(body.messages)) {
    const messages = [];
    const buffered = [];
    const foldSystemTurns = options?.foldSystemTurns === true;
    for (const msg of body.messages) {
      if (msg.role === ROLE.SYSTEM) {
        const blocks = Array.isArray(msg.content) ?
        msg.content :
        isString(msg.content) && msg.content ?
        [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }] :
        [];
        if (!foldSystemTurns) {
          messages.push(msg);
          continue;
        }
        buffered.push(...blocks.filter((block) => USER_SYSTEM_FOLDABLE_BLOCKS.has(block?.type)));
        continue;
      }
      if (foldSystemTurns && buffered.length && msg.role === ROLE.USER) {
        const existing = Array.isArray(msg.content) ?
        msg.content :
        isString(msg.content) && msg.content ?
        [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }] :
        [];
        msg.content = [...existing, ...buffered];
        buffered.length = 0;
      }
      messages.push(msg);
    }
    if (!foldSystemTurns) {
      const hoisted = messages.
      filter((m) => m.role === ROLE.SYSTEM).
      flatMap((m) => Array.isArray(m.content) ?
      m.content :
      isString(m.content) && m.content ?
      [{ type: CLAUDE_BLOCK.TEXT, text: m.content }] :
      []).
      filter((block) => HOISTABLE_SYSTEM_BLOCKS.has(block?.type));
      body.messages = messages.filter((m) => m.role !== ROLE.SYSTEM);
      if (hoisted.length) {
        const existing = Array.isArray(body.system) ?
        body.system :
        isString(body.system) && body.system ?
        [{ type: CLAUDE_BLOCK.TEXT, text: body.system }] :
        [];
        body.system = [...existing, ...hoisted];
      }
    } else {
      // Never fold trailing system content backward into a completed user turn.
      body.messages = messages;
    }
  }
  normalizeClaudeServerToolModels(body.tools);

  // 3. Drop thinking blocks whose signature is not Claude's (combo mixes models,
  // so foreign signatures leak into history and Anthropic rejects them). Drop
  // foreign server-tool references in the same pass and preserve their results
  // below as ordinary text.
  // Fable/Mythos also reject unsigned/default-placeholder history and never get
  // synthetic placeholders.
  const thinkingEnabled = body.thinking?.type === "enabled";
  const removedServerToolIds = new Set();
  const emptiedByServerToolFilter = new Set();
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role !== ROLE.ASSISTANT || !Array.isArray(msg.content)) continue;
      let hasToolUse = false;
      let hasKeptThinking = false;
      let removedServerTool = false;
      const kept = [];
      for (const block of msg.content) {
        if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
          const isAdaptiveModel = isAdaptiveThinkingModel(model);
          const isPlaceholder = block.signature === DEFAULT_THINKING_CLAUDE_SIGNATURE;
          const valid = isValidClaudeSignature(block.signature) && !isPlaceholder;
          if (isAdaptiveModel) {
            if (valid) {
              hasKeptThinking = true;
              kept.push(block);
            }
          } else if (provider !== "claude" || isValidClaudeSignature(block.signature)) {
            hasKeptThinking = true;
            kept.push(block);
          }
          continue;
        }
        if (hasForeignClaudeServerToolId(block)) {
          removedServerToolIds.add(serverToolIdKey(block.id));
          removedServerTool = true;
          continue;
        }
        if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
        kept.push(block);
      }
      msg.content = kept;
      if (removedServerTool && kept.length === 0) emptiedByServerToolFilter.add(msg);
      if (thinkingEnabled && !hasKeptThinking && hasToolUse && !isAdaptiveThinkingModel(model)) {
        msg.content.unshift(buildThinkingPlaceholder("claude"));
      }
    }

    if (removedServerToolIds.size > 0) {
      for (const msg of body.messages) {
        if (!Array.isArray(msg.content)) continue;
        msg.content = msg.content.map((block) =>
        (block?.type === CLAUDE_BLOCK.TOOL_RESULT || block?.type === CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT) &&
        removedServerToolIds.has(serverToolIdKey(block.tool_use_id)) ?
        demoteUnpairedToolResult(block) :
        block
        );
      }
      body.messages = body.messages.filter((msg) => !emptiedByServerToolFilter.has(msg));
    }
  }

  reconcileClaudeThinkingBudget(body, provider, customMaxOutput);
  applyAssistantPrefillPolicy(body, options?.rawHeaders);
  return body;
}

// Prepare request for Claude format endpoints
// - Cleanup cache_control
// - Filter empty messages
// - Add thinking block for Anthropic endpoint (provider === "claude")
// - Fix tool_use/tool_result ordering
// - Apply cloaking (billing header + fake user ID) for OAuth tokens
export function prepareClaudeRequest(body, provider = null, apiKey = null, connectionId = null, rawHeaders = null, sessionId = null, customMaxOutput = null) {
  const dropsClaudeCacheControl = PROVIDERS[provider]?.quirks?.dropClaudeCacheControl ||
  provider === "ollama" ||
  provider === "ollama-local";
  const allowCacheControl = !dropsClaudeCacheControl;
  // quirk: MiniMax's Claude-compatible endpoint rejects Anthropic's output_config (400 invalid params)
  if (PROVIDERS[provider]?.quirks?.dropOutputConfig) {
    delete body.output_config;
  }

  reconcileClaudeThinkingBudget(body, provider, customMaxOutput);

  // 1. System: remove all cache_control, add only to last block with ttl 1h
  if (body.system && Array.isArray(body.system)) {
    body.system = body.system.map((block, i) => {
      const { cache_control, ...rest } = block;
      if (allowCacheControl && i === body.system.length - 1) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });
  }

  // 2. Messages: process in optimized passes
  if (body.messages && Array.isArray(body.messages)) {
    const len = body.messages.length;
    let filtered = [];

    // Pass 1: remove cache_control + filter empty messages
    for (let i = 0; i < len; i++) {
      const msg = body.messages[i];

      // Remove cache_control from content blocks
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          delete block.cache_control;
        }
      }

      // Keep final assistant even if empty, otherwise check valid content
      const isFinalAssistant = i === len - 1 && msg.role === ROLE.ASSISTANT;
      if (isFinalAssistant || hasValidContent(msg)) {
        filtered.push(msg);
      }
    }

    // Pass 1.5: Fix tool_use/tool_result ordering
    // Each tool_use must have tool_result in the NEXT message (not same message with other content)
    filtered = fixToolUseOrdering(filtered);

    body.messages = filtered;
    applyAssistantPrefillPolicy(body, rawHeaders);
    filtered = body.messages;

    // Check if thinking is enabled AND last message is from user
    const lastMessage = filtered[filtered.length - 1];
    const lastMessageIsUser = lastMessage?.role === ROLE.USER;
    const thinkingEnabled = body.thinking?.type === "enabled" && lastMessageIsUser;

    // Pass 2 (reverse): add cache_control to last assistant + handle thinking for Anthropic
    let lastAssistantProcessed = false;
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i];

      if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
        // Add cache_control to last non-thinking block of first (from end) assistant with content
        // thinking/redacted_thinking blocks do not support cache_control
        if (allowCacheControl && !lastAssistantProcessed && msg.content.length > 0) {
          for (let j = msg.content.length - 1; j >= 0; j--) {
            const block = msg.content[j];
            if (block.type !== CLAUDE_BLOCK.THINKING && block.type !== CLAUDE_BLOCK.REDACTED_THINKING) {
              block.cache_control = { type: "ephemeral" };
              break;
            }
          }
          lastAssistantProcessed = true;
        }

        // Handle thinking blocks for Anthropic-compatible endpoints.
        if (handlesThinkingBlocks(provider)) {
          let hasToolUse = false;
          let hasKeptThinking = false;

          // Claude native: preserve valid signatures, drop invalid blocks.
          // anthropic-compatible: replace with default (safe fallback for lenient upstreams).
          // DeepSeek: keep existing thinking as-is; add an unsigned placeholder only if missing.
          const isClaudeNative = provider === "claude";
          const preservesNativeThinkingBlocks = provider === "ollama" || provider === "ollama-local";
          const isDeepSeek = provider === "deepseek";
          const isAdaptiveModel = isAdaptiveThinkingModel(body.model);
          const kept = [];
          for (const block of msg.content) {
            const isThinking = block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING;
            if (isThinking) {
              if (preservesNativeThinkingBlocks) {
                hasKeptThinking = true;
                kept.push(block);
              } else if (isClaudeNative) {
                if (isAdaptiveModel) {
                  if (isValidClaudeSignature(block.signature) && block.signature !== DEFAULT_THINKING_CLAUDE_SIGNATURE) {
                    hasKeptThinking = true;
                    kept.push(block);
                  }
                } else if (isValidClaudeSignature(block.signature)) {
                  hasKeptThinking = true;
                  kept.push(block);
                }
              } else if (isDeepSeek) {
                hasKeptThinking = true;
                kept.push(block);
              } else {
                block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
                hasKeptThinking = true;
                kept.push(block);
              }
              continue;
            }
            if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
            kept.push(block);
          }
          msg.content = kept;

          // Add thinking block if thinking enabled + has tool_use but no thinking
          if (thinkingEnabled && !hasKeptThinking && hasToolUse && !isAdaptiveModel) {
            msg.content.unshift(buildThinkingPlaceholder(provider));
          }
        }
      }
    }
  }

  // 3. Tools: filter built-in tools for non-Anthropic providers, then handle cache_control
  if (body.tools && Array.isArray(body.tools)) {
    // Strip built-in tools (e.g. web_search_20250305) and normalize to Anthropic-native shape
    // (drop `type` field, fold `function.{name,description,parameters}`) for non-Anthropic providers
    if (provider !== "claude") {
      body.tools = body.tools.
      filter((tool) => !tool.type || tool.type === "function").
      map((tool) => {
        if (tool.function) {
          return {
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters
          };
        }
        const { type, ...rest } = tool;
        return rest;
      });
    }

    const lastCacheable = lastCacheableToolIndex(body.tools);
    body.tools = body.tools.map((tool, i) => {
      const { cache_control, ...rest } = tool;
      if (allowCacheControl && i === lastCacheable) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });

    // Remove tools array and tool_choice if empty after filtering
    if (body.tools.length === 0) {
      delete body.tools;
      delete body.tool_choice;
    }
  }

  // Apply cloaking for OAuth tokens (billing header + fake user ID)
  // session_id in user_id must match X-Claude-Code-Session-Id for fingerprint consistency
  if ((provider === "claude" || provider?.startsWith("anthropic-compatible")) && apiKey) {
    const sid = sessionId || resolveSessionId({ headers: rawHeaders, body, connectionId, scope: "claude" });
    body = applyCloaking(body, apiKey, sid);
  }

  return body;
}