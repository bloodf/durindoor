import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { CLAUDE_BLOCK } from "../schema/index.js";

// Process-local authentication prevents clients forging signed Claude blocks.
// A restart invalidates old envelopes rather than accepting unverifiable history.
const key = randomBytes(32);
export const CLAUDE_THINKING_PREFIX = "x-durindoor-claude-thinking-v1:";
const limit = 2 * 1024 * 1024;

function valid(block) {
  if (!block || !isObject(block) || Array.isArray(block)) return false;
  const keys = Object.keys(block).sort().join(",");
  return block.type === CLAUDE_BLOCK.THINKING && keys === "signature,thinking,type" &&
    isString(block.thinking) && isString(block.signature) && !!block.signature ||
    block.type === CLAUDE_BLOCK.REDACTED_THINKING && keys === "data,type" &&
    isString(block.data) && !!block.data;
}

export function encodeClaudeThinking(model, blocks) {
  if (!isString(model) || !model || !Array.isArray(blocks) || !blocks.length || !blocks.every(valid)) return null;
  const payload = Buffer.from(JSON.stringify({ model, blocks })).toString("base64url");
  if (payload.length > limit) return null;
  const mac = createHmac("sha256", key).update(payload).digest("base64url");
  return `${CLAUDE_THINKING_PREFIX}${payload}.${mac}`;
}

export function decodeClaudeThinking(value, model) {
  if (!isString(value) || !value.startsWith(CLAUDE_THINKING_PREFIX) || value.length > limit + 128) return null;
  const parts = value.slice(CLAUDE_THINKING_PREFIX.length).split(".");
  if (parts.length !== 2 || !/^[\w-]+$/.test(parts[0]) || !/^[\w-]+$/.test(parts[1])) return null;
  const expected = createHmac("sha256", key).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || actual.toString("base64url") !== parts[1] || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return payload.model === model && isString(model) && model && Array.isArray(payload.blocks) && payload.blocks.length && payload.blocks.every(valid) ? payload.blocks : null;
  } catch { return null; }
}
