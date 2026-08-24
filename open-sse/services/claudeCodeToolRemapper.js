/**
 * Claude Code tool name remapping.
 *
 * Anthropic uses tool name fingerprinting to detect third-party clients.
 * Real Claude Code uses TitleCase tool names (Bash, Read, Write, etc.)
 * while third-party clients like OpenCode use lowercase.
 *
 * This module remaps tool names in both directions:
 * - Request path: lowercase → TitleCase (before sending to Anthropic)
 * - Response path: TitleCase → lowercase (for clients expecting lowercase)
 *
 * Ported from OmniRoute #6586 (.ts → .js, this fork has no TS toolchain).
 * The 6586 review follow-up also added the `if (!tool) continue;` null guard.
 *
 * Codex P2 follow-ups (PR #95):
 * 1. Apply the request-specific tool map BEFORE the generic reverse map, so
 *    aliases the cloak introduced (e.g. `Bash` for `run_command`) get
 *    de-cloaked to the client's original name, not the generic `bash`.
 * 2. When the operator kill-switch is set and the request already carries
 *    `_toolNameMap` from an earlier translation, return that existing map
 *    (not an empty Map) so response tool calls can still be de-cloaked.
 * 3. Reverse tool aliases longest-first so substrings don't shadow
 *    longer ones (e.g. `Edit` should not replace `MultiEdit`).
 * 4. Restrict response remapping to JSON tool-name fields, not free text,
 *    so a model response that says "Run Bash" is not delivered as
 *    "Run bash".
 */

import { EXTRA_TOOL_RENAME_MAP } from "./claudeCodeExtraRemap.js";
import { isObject, isString } from "@/shared/utils/typeChecks.js";

const TOOL_RENAME_MAP = {
  ...EXTRA_TOOL_RENAME_MAP,
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  task: "Task",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  todowrite: "TodoWrite",
  todoread: "TodoRead",
  question: "Question",
  skill: "Skill",
  multiedit: "MultiEdit",
  notebook: "Notebook",
  lsp: "Lsp",
  apply_patch: "ApplyPatch"
};

const REVERSE_MAP = {};
for (const [k, v] of Object.entries(TOOL_RENAME_MAP)) {
  REVERSE_MAP[v] = k;
}

// Codex P2: when iterating reverse map, longest alias first so substrings
// like "Edit" do not shadow "MultiEdit". Sort by entry key length desc.
function reverseEntriesLongestFirst() {
  return Object.entries(REVERSE_MAP).sort(
    ([a], [b]) => b.length - a.length
  );
}

function getRequestToolNameMap(body) {
  const existing = body._toolNameMap instanceof Map ? body._toolNameMap : new Map();
  Object.defineProperty(body, "_toolNameMap", {
    value: existing,
    enumerable: false,
    configurable: true,
    writable: true
  });
  return existing;
}

function trackToolName(body, titleCaseName, originalName) {
  getRequestToolNameMap(body).set(titleCaseName, originalName);
}

/**
 * Names of Anthropic server-side tools declared in this request's tools[].
 * A server tool's `name` is a reserved literal validated against its `type`
 * (web_search_20250305 ⇒ "web_search", bash_20250124 ⇒ "bash", …), so every
 * rewrite below must leave both the declaration AND any history/tool_choice
 * reference to it untouched.
 */
function collectServerToolNames(tools) {
  const names = new Set();
  if (!Array.isArray(tools)) return names;
  for (const tool of tools) {
    const t = tool;
    if (t && isAnthropicServerToolType(t.type) && isString(t.name)) {
      names.add(t.name);
    }
  }
  return names;
}

export function remapToolNamesInRequest(body) {
  let hasLowercase = false;
  let hasTitleCase = false;
  const serverToolNames = collectServerToolNames(body.tools);

  // Remap tool definitions
  const tools = body.tools;
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (!tool) continue;
      // Server tools (bash_20250124 / web_search_20250305 / …) keep their
      // type-bound literal name.
      if (isAnthropicServerToolType(tool.type)) continue;
      const name = String(tool.name || "");
      if (TOOL_RENAME_MAP[name]) {
        const mapped = TOOL_RENAME_MAP[name];
        tool.name = mapped;
        trackToolName(body, mapped, name);
        hasLowercase = true;
      } else if (REVERSE_MAP[name]) {
        hasTitleCase = true;
      }
    }
  }

  // Remap message history tool_use blocks (assistant role)
  const messages = body.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg || msg.role !== "assistant") continue;
      const content = msg.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type === "tool_use" && isString(block.name)) {
          if (serverToolNames.has(block.name)) continue;
          const mapped = TOOL_RENAME_MAP[block.name];
          if (mapped) {
            const originalName = block.name;
            block.name = mapped;
            trackToolName(body, mapped, originalName);
            hasLowercase = true;
          } else if (REVERSE_MAP[block.name]) {
            hasTitleCase = true;
          }
        }
      }
    }
  }

  // Remap tool_choice
  const toolChoice = body.tool_choice;
  if (
  toolChoice?.type === "tool" && isString(
    toolChoice.name) &&
  !serverToolNames.has(toolChoice.name))
  {
    const mapped = TOOL_RENAME_MAP[toolChoice.name];
    if (mapped) {
      const originalName = toolChoice.name;
      toolChoice.name = mapped;
      trackToolName(body, mapped, originalName);
      hasLowercase = true;
    } else if (REVERSE_MAP[toolChoice.name]) {
      hasTitleCase = true;
    }
  }

  return hasLowercase || hasTitleCase;
}

/**
 * Codex P2: restrict reverse-map to JSON tool-name fields. We do not rewrite
 * free text, so a model response like "Run Bash" is NOT delivered as
 * "Run bash". The caller passes a response payload object (or JSON string);
 * we walk the structure and only mutate the `name`, `toolName`, and
 * `tool_call_id` fields on tool_use / tool_result / tool blocks.
 *
 * Codex P2 also fixes the request-specific map: the per-request tool map
 * is applied FIRST so that aliases the cloak introduced (e.g. `Bash` for
 * `run_command`) are de-cloaked to the client's original name, not the
 * generic reverse map's `bash`.
 */
const TOOL_NAME_KEYS = new Set(["name", "toolName", "tool_name"]);
const TOOL_BLOCK_TYPES = new Set(["tool_use", "tool_result", "toolCall", "function"]);

function applyNameReplacementsToObject(value, orderedReplacements, perRequest, depth = 0) {
  if (value === null || value === undefined) return;
  if (depth > 12) return; // safety: structured payloads don't go this deep
  if (Array.isArray(value)) {
    for (const item of value) {
      applyNameReplacementsToObject(item, orderedReplacements, perRequest, depth + 1);
    }
    return;
  }
  if (!isObject(value)) return;

  for (const key of Object.keys(value)) {
    if (
    TOOL_NAME_KEYS.has(key) && isString(
      value[key]) &&
    /^[A-Z]/.test(value[key]))
    {
      // 1) Per-request map first.
      if (perRequest && perRequest.size) {
        const perReqHit = perRequest.get(value[key]);
        if (perReqHit) {
          value[key] = perReqHit;
        } else {
          // 2) Generic reverse map.
          for (const [titleCase, lowercase] of orderedReplacements) {
            if (value[key] === titleCase) {
              value[key] = lowercase;
              break;
            }
          }
        }
      } else {
        for (const [titleCase, lowercase] of orderedReplacements) {
          if (value[key] === titleCase) {
            value[key] = lowercase;
            break;
          }
        }
      }
    } else if (isObject(value[key])) {
      // Recurse into nested objects/arrays.
      applyNameReplacementsToObject(value[key], orderedReplacements, perRequest, depth + 1);
    }
  }
}

export function remapToolNamesInResponse(payload, forceLowercase = true, toolNameMap) {
  if (payload === null || payload === undefined) return payload;

  const ordered = reverseEntriesLongestFirst();
  // Per Codex P2: when forceLowercase is false, generic reverse map should
  // not lowercase (the response may legitimately contain the canonical
  // TitleCase alias for the client's own canonical name).
  const effective = forceLowercase ?
  ordered :
  []; // skip generic lowercasing when caller asks to preserve case

  // Parse JSON if the caller passed a string; otherwise walk the object.
  let parsed = payload;
  let ownsParsed = false;
  if (isString(payload)) {
    try {
      parsed = JSON.parse(payload);
      ownsParsed = true;
    } catch {
      // Not JSON — payload is a free-text assistant message. We do NOT
      // rewrite free text under any circumstance (Codex P2 #4). Return as-is.
      return payload;
    }
  }
  if (parsed === null || !isObject(parsed)) {
    return ownsParsed ? payload : parsed;
  }

  applyNameReplacementsToObject(parsed, effective, toolNameMap);
  return ownsParsed ? JSON.stringify(parsed) : parsed;
}

export { TOOL_RENAME_MAP, REVERSE_MAP };

const CLAUDE_BUILTIN_TOOL_NAMES = new Set(Object.values(TOOL_RENAME_MAP));

const HARNESS_CANONICAL_MAP = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  list_files: "Glob",
  search_files: "Grep",
  run_command: "Bash",
  search_web: "WebSearch",
  fetch_url: "WebFetch",
  list_directory: "Glob",
  file_search: "Glob",
  content_search: "Grep"
};

function toPascalCaseToolName(name) {
  if (!name) return name;
  const parts = name.split(/[_-]+/).filter(Boolean);
  if (parts.length === 0) return name;
  return parts.
  map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).
  join("");
}

// Normalize an incoming Claude-style tool name: prefer a per-request
// toolNameMap override (third-party aliases), then fall back to the
// built-in lowercase→PascalCase case map, then the response-side
// REVERSE_MAP (cloaked alias → original), else pass through unchanged.
export function normalizeClaudeToolName(name, toolNameMap) {
  if (!name || !isString(name)) return name;
  if (toolNameMap instanceof Map) {
    const mapped = toolNameMap.get(name) ?? toolNameMap.get(name.toLowerCase());
    if (mapped) return mapped;
  }
  const lower = name.toLowerCase();
  return TOOL_RENAME_MAP[lower] ?? REVERSE_MAP[name] ?? name;
}

export function needsThirdPartyCloak(name) {
  if (!name) return false;
  if (CLAUDE_BUILTIN_TOOL_NAMES.has(name)) return false;
  if (name.startsWith("mcp__")) return false;
  if (/^[A-Z][A-Za-z0-9]*$/.test(name)) return false;
  return true;
}

const VERSIONED_SERVER_TOOL_TYPE = /^[a-z][a-z0-9_]*_\d{8}$/;
const NON_VERSIONED_SERVER_TOOL_TYPES = new Set(["web_search", "web_search_preview"]);

export function isAnthropicServerToolType(type) {
  if (!isString(type) || type.length === 0) return false;
  return VERSIONED_SERVER_TOOL_TYPE.test(type) || NON_VERSIONED_SERVER_TOOL_TYPES.has(type);
}

export function cloakThirdPartyToolNames(body, options) {
  const tools = body.tools;
  const serverToolNames = collectServerToolNames(tools);
  const existingMap =
  body._toolNameMap instanceof Map ? body._toolNameMap : null;

  // Codex P2: when the kill-switch is on, return the existing per-request
  // map if the request already carried one (so the response path can
  // still de-cloak tool names introduced by an earlier translation).
  // Do not perform any further cloaking in this path.
  if (process.env.CLAUDE_DISABLE_TOOL_NAME_CLOAK === "true") {
    return existingMap ?? new Map();
  }

  const shouldCloak = (name) =>
  needsThirdPartyCloak(name) && !(options?.skip ? options.skip(name) : false);

  const used = new Set();
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (tool && isString(tool.name)) used.add(tool.name);
    }
  }
  if (existingMap) {
    for (const alias of existingMap.keys()) used.add(alias);
  }

  let nameMap = existingMap;
  const assigned = new Map();

  const aliasFor = (original) => {
    const existing = assigned.get(original);
    if (existing) return existing;
    const base =
    TOOL_RENAME_MAP[original] ??
    HARNESS_CANONICAL_MAP[original] ??
    toPascalCaseToolName(original);
    let alias = base;
    let suffix = 2;
    while (alias !== original && used.has(alias)) {
      alias = `${base}${suffix++}`;
    }
    used.delete(original);
    used.add(alias);
    assigned.set(original, alias);
    if (!nameMap) nameMap = getRequestToolNameMap(body);
    nameMap.set(alias, original);
    return alias;
  };

  // Non-mutating: clone changed entries rather than rewriting the caller's
  // objects in place.
  if (Array.isArray(tools)) {
    body.tools = tools.map((tool) => {
      if (!tool) return tool;
      if (isAnthropicServerToolType(tool.type)) {
        return tool;
      }
      if (isString(tool.name) && shouldCloak(tool.name)) {
        return { ...tool, name: aliasFor(tool.name) };
      }
      return tool;
    });
  }

  const messages = body.messages;
  if (Array.isArray(messages)) {
    body.messages = messages.map((message) => {
      const content = message?.content;
      if (!Array.isArray(content)) return message;
      let changed = false;
      const newContent = content.map((block) => {
        if (
        block?.type === "tool_use" && isString(
          block.name) &&
        !serverToolNames.has(block.name) &&
        shouldCloak(block.name))
        {
          changed = true;
          return { ...block, name: aliasFor(block.name) };
        }
        return block;
      });
      return changed ? { ...message, content: newContent } : message;
    });
  }

  const toolChoice = body.tool_choice;
  if (
  toolChoice?.type === "tool" && isString(
    toolChoice.name) &&
  !serverToolNames.has(toolChoice.name) &&
  shouldCloak(toolChoice.name))
  {
    body.tool_choice = { ...toolChoice, name: aliasFor(toolChoice.name) };
  }

  return nameMap ?? new Map();
}