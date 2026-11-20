// Deferred MCP tool normalization for Claude-wire providers.
//
// Claude Code declares deferred MCP tools mid-session as `tool_addition`
// content blocks. Kimi's Claude-compatible endpoint accepts those definitions
// in `tools[]`, but rejects the beta-only blocks themselves, so the turn never
// reaches the model.
//
// The normalizer lives in its own concerns module (not in formats/claude.js) so
// the established Claude format module interface stays untouched: the
// force-stream-config suite replaces formats/claude.js with a closed mock and
// must keep working.
import { CLAUDE_BLOCK } from "../schema/index.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";

/**
 * Hoist every `tool_addition` definition into `tools[]` (deduplicated by
 * name), drop the block, and remove the turns the removal emptied.
 *
 * The caller's body is never mutated: another account/provider attempt must be
 * able to translate the original request independently.
 *
 * @param {object} body Claude-wire request body.
 * @returns {object} The normalized body, or the original body when unchanged.
 */
export function normalizeDeferredTools(body) {
  if (!Array.isArray(body?.messages)) return body;

  const names = new Set();
  const tools = Array.isArray(body.tools) ? [...body.tools] : [];
  for (const tool of tools) {
    if (isString(tool?.name)) names.add(tool.name);
  }

  let changed = false;
  let hoisted = 0;
  const messages = [];

  for (const msg of body.messages) {
    if (!Array.isArray(msg.content)) {
      messages.push(msg);
      continue;
    }
    const content = [];
    let removed = false;
    for (const block of msg.content) {
      if (block?.type !== CLAUDE_BLOCK.TOOL_ADDITION) {
        content.push(block);
        continue;
      }
      removed = true;
      changed = true;
      const definition = block.tool?.definition;
      const name = definition?.name;
      if (isString(name) && name && !names.has(name)) {
        tools.push({ ...definition });
        names.add(name);
        hoisted += 1;
      }
    }
    if (!removed) {
      messages.push(msg);
      continue;
    }
    // A turn left empty by the removal carries no context: drop it.
    if (!content.length) continue;
    messages.push({ ...msg, content });
  }

  if (!changed) return body;

  const result = { ...body, messages };
  // Only touch `tools` when a definition was actually hoisted, so a request
  // without tools keeps its original shape.
  if (hoisted > 0) result.tools = tools;
  return result;
}
