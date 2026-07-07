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
 */

import { EXTRA_TOOL_RENAME_MAP } from "./claudeCodeExtraRemap.js";

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
  apply_patch: "ApplyPatch",
};

const REVERSE_MAP = {};
for (const [k, v] of Object.entries(TOOL_RENAME_MAP)) {
  REVERSE_MAP[v] = k;
}

function getRequestToolNameMap(body) {
  const existing = body._toolNameMap instanceof Map ? body._toolNameMap : new Map();
  Object.defineProperty(body, "_toolNameMap", {
    value: existing,
    enumerable: false,
    configurable: true,
    writable: true,
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
    if (t && isAnthropicServerToolType(t.type) && typeof t.name === "string") {
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
        if (block.type === "tool_use" && typeof block.name === "string") {
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
    toolChoice?.type === "tool" &&
    typeof toolChoice.name === "string" &&
    !serverToolNames.has(toolChoice.name)
  ) {
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

export function remapToolNamesInResponse(text, forceLowercase = true, toolNameMap) {
  if (!text) return text;
  let out = text;
  for (const [titleCase, lowercase] of Object.entries(REVERSE_MAP)) {
    if (out.includes(titleCase)) {
      out = out.split(titleCase).join(forceLowercase ? lowercase : titleCase);
    }
  }
  if (toolNameMap && toolNameMap.size) {
    for (const [titleCase, original] of toolNameMap.entries()) {
      if (out.includes(titleCase)) {
        out = out.split(titleCase).join(original);
      }
    }
  }
  return out;
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
  content_search: "Grep",
};

function toPascalCaseToolName(name) {
  if (!name) return name;
  const parts = name.split(/[_-]+/).filter(Boolean);
  if (parts.length === 0) return name;
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
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
  if (typeof type !== "string" || type.length === 0) return false;
  return VERSIONED_SERVER_TOOL_TYPE.test(type) || NON_VERSIONED_SERVER_TOOL_TYPES.has(type);
}

export function cloakThirdPartyToolNames(body, options) {
  // Operator kill-switch (documented in .env.example / ENVIRONMENT.md).
  if (process.env.CLAUDE_DISABLE_TOOL_NAME_CLOAK === "true") {
    return new Map();
  }
  const shouldCloak = (name) =>
    needsThirdPartyCloak(name) && !(options?.skip ? options.skip(name) : false);
  const tools = body.tools;
  const serverToolNames = collectServerToolNames(tools);

  const used = new Set();
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (tool && typeof tool.name === "string") used.add(tool.name);
    }
  }
  const existingMap =
    body._toolNameMap instanceof Map ? body._toolNameMap : null;
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
      if (typeof tool.name === "string" && shouldCloak(tool.name)) {
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
          block?.type === "tool_use" &&
          typeof block.name === "string" &&
          !serverToolNames.has(block.name) &&
          shouldCloak(block.name)
        ) {
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
    toolChoice?.type === "tool" &&
    typeof toolChoice.name === "string" &&
    !serverToolNames.has(toolChoice.name) &&
    shouldCloak(toolChoice.name)
  ) {
    body.tool_choice = { ...toolChoice, name: aliasFor(toolChoice.name) };
  }

  return nameMap ?? new Map();
}
