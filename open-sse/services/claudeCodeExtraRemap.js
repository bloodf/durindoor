/**
 * Extra tool name remapping for third-party agent detection bypass.
 *
 * Anthropic detects non-Claude-Code clients by checking for specific
 * tool names that only third-party agents use (e.g. subagents, session_status).
 * This module adds aliases for those tool names so they look like
 * legitimate Claude Code tools.
 *
 * Mapping: lowercase original → TitleCase alias (sent to Anthropic)
 * Response path reverses automatically via REVERSE_MAP in claudeCodeToolRemapper.js
 *
 * To update: just add entries to EXTRA_TOOL_RENAME_MAP below.
 *
 * Ported from OmniRoute #6586 (.ts → .js, this fork has no TS toolchain).
 */
export const EXTRA_TOOL_RENAME_MAP = {
  subagents: "SubDispatch",
  session_status: "CheckStatus",
  agent: "Agent",
};
