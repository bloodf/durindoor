// codex-rs MultiAgent V2 stamps its own collaboration tool calls with an
// `encrypted_function_args: []` marker so the CLI knows the arguments are
// plaintext, not the usual encrypted blob. A translated/projected
// function_call item that drops the marker makes codex-rs treat readable
// args as opaque, breaking spawn_agent/send_message/followup_task.
// Upstream provenance: diegosouzapw/OmniRoute 38cbb7ef8 (#14447).
const CODEX_MULTIAGENT_NAMESPACE = "collaboration";
const CODEX_MULTIAGENT_TOOL_NAMES = new Set(["spawn_agent", "send_message", "followup_task"]);

/**
 * Whether a resolved Responses tool call is a codex-rs MultiAgent V2
 * collaboration call that must carry the plaintext-args marker.
 *
 * @param {{name?: string, namespace?: string}} resolved Resolved `{name, namespace}` tool identity.
 * @returns {boolean} `true` when the item needs `encrypted_function_args: []`.
 */
export function isCodexMultiAgentPlaintextTool(resolved) {
  return resolved?.namespace === CODEX_MULTIAGENT_NAMESPACE &&
  CODEX_MULTIAGENT_TOOL_NAMES.has(resolved?.name);
}
