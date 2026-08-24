/**
 * session-dedup compression engine (R11 / N2 / TO1)
 *
 * Content-addressed cross-turn deduplication, inspired by the TokenMizer
 * session-graph + line-dedup blueprint (arXiv 2606.06337) and sqz prior-art.
 *
 * Algorithm (two-pass, suffix-block content-addressed):
 *   Pass 1 — scan all non-system messages. For each message, enumerate suffix
 *             line blocks (lines[start..end-of-message]) that meet minBlockChars
 *             and minBlockLines. Hash each block. Record the first message that
 *             owns each hash.
 *   Pass 2 — for each non-system message (index i), find blocks whose hash was
 *             first seen in a STRICTLY EARLIER message (index j < i). Replace the
 *             LONGEST such block's text with `[dedup:ref sha=<24hex>]`.
 *             First occurrence is always kept intact.
 *
 * Greedy, longest-first replacement: sort duplicate blocks by length descending;
 * replace the longest block first so shorter overlapping candidates are skipped.
 *
 * Conservative guards:
 *   - Never touch `role: "system"`.
 *   - Never touch multipart content parts other than `type: "text"`.
 *   - Only dedup blocks ≥ minBlockChars (default 80 chars) AND ≥ MIN_BLOCK_LINES lines.
 *   - First occurrence is ALWAYS kept intact; only later identical occurrences are replaced.
 */

import crypto from "node:crypto";
import { createCompressionStats } from "../../stats.js";
import { runFuzzyPass } from "./fuzzy.js";
import { isBoolean, isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";

const ENGINE_ID = "session-dedup";
const DEFAULT_MIN_BLOCK_CHARS = 80;
const MIN_BLOCK_LINES = 3;

function hashBlock(text) {
  // 24 hex / 96 bits — collision-resistant. Pass 2 additionally verifies block equality
  // before substituting, so a collision can never cause corruption.
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function findSuffixBlocks(lines, minBlockChars) {
  const n = lines.length;
  const seen = new Set();
  const results = [];

  for (let start = 0; start < n; start++) {
    const block = lines.slice(start).join("\n");
    const blockLines = n - start;
    if (blockLines >= MIN_BLOCK_LINES && block.length >= minBlockChars && !seen.has(block)) {
      seen.add(block);
      results.push({ block, startLine: start });
    }
  }
  return results;
}

function dedupeWithinMessage(text, minBlockChars) {
  const lines = text.split("\n");
  const blocks = findSuffixBlocks(lines, minBlockChars);

  if (blocks.length < 2) return { deduped: text, changed: false };

  const blockFreq = new Map();
  for (const { block } of blocks) {
    blockFreq.set(block, (blockFreq.get(block) || 0) + 1);
  }

  const sortedBlocks = [...blocks].sort((a, b) => {
    const freqDiff = (blockFreq.get(b.block) || 0) - (blockFreq.get(a.block) || 0);
    return freqDiff !== 0 ? freqDiff : b.block.length - a.block.length;
  });

  let result = text;
  let changed = false;

  for (const { block } of sortedBlocks) {
    const occurrences = (
    result.match(new RegExp(block.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).
    length;
    if (occurrences < 2) continue;

    const sha = hashBlock(block);
    const marker = `[dedup:ref sha=${sha}]`;
    let count = 0;
    result = result.replace(new RegExp(block.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), () => {
      count++;
      return count === 1 ? block : marker;
    });
    changed = true;
  }

  return { deduped: result, changed };
}

function dedupMessageTexts(msgTexts, minBlockChars) {
  const deduped = new Map();
  let dedupCount = 0;

  if (msgTexts.length === 1) {
    const { text, msgIdx } = msgTexts[0];
    const { deduped: dedupedText, changed } = dedupeWithinMessage(text, minBlockChars);
    if (changed) {
      deduped.set(msgIdx, dedupedText);
      dedupCount++;
    }
    return { deduped, dedupCount };
  }

  const firstSeen = new Map();

  for (const { msgIdx, text } of msgTexts) {
    const lines = text.split("\n");
    const blocks = findSuffixBlocks(lines, minBlockChars);
    for (const { block } of blocks) {
      const sha = hashBlock(block);
      if (!firstSeen.has(sha)) {
        firstSeen.set(sha, { ownerMsgIdx: msgIdx, block });
      }
    }
  }

  for (const { msgIdx, text } of msgTexts) {
    const lines = text.split("\n");
    const blocks = findSuffixBlocks(lines, minBlockChars);

    const dupBlocks = [];
    for (const { block } of blocks) {
      const sha = hashBlock(block);
      const owner = firstSeen.get(sha);
      // owner.block === block guards against a hash collision substituting a marker that
      // would reference the wrong block.
      if (owner && owner.ownerMsgIdx < msgIdx && owner.block === block) {
        dupBlocks.push({ block, sha });
      }
    }

    if (dupBlocks.length === 0) continue;

    dupBlocks.sort((a, b) => b.block.length - a.block.length);

    let result = text;
    let changed = false;
    const replaced = new Set();

    for (const { block, sha } of dupBlocks) {
      if ([...replaced].some((r) => r.includes(block))) continue;

      const idx = result.indexOf(block);
      if (idx !== -1) {
        const marker = `[dedup:ref sha=${sha}]`;
        result = result.slice(0, idx) + marker + result.slice(idx + block.length);
        changed = true;
        replaced.add(block);
        break;
      }
    }

    if (changed) {
      deduped.set(msgIdx, result);
      dedupCount++;
    }
  }

  return { deduped, dedupCount };
}

function processMessages(messages, minBlockChars) {
  const msgTexts = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "system") continue;
    if (isString(msg.content)) {
      msgTexts.push({ msgIdx: i, text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (let p = 0; p < msg.content.length; p++) {
        const part = msg.content[p];
        if (part["type"] === "text" && isString(part["text"])) {
          msgTexts.push({ msgIdx: i * 100000 + p + 1, text: part["text"] });
        }
      }
    }
  }

  if (msgTexts.length === 0) {
    return { messages, dedupCount: 0 };
  }

  const { deduped, dedupCount } = dedupMessageTexts(msgTexts, minBlockChars);

  if (dedupCount === 0) {
    return { messages, dedupCount: 0 };
  }

  const result = messages.map((msg, i) => {
    if (msg.role === "system") return { ...msg };

    if (isString(msg.content)) {
      const replacement = deduped.get(i);
      return replacement !== undefined ? { ...msg, content: replacement } : { ...msg };
    }

    if (Array.isArray(msg.content)) {
      let changed = false;
      const newContent = msg.content.map((part, p) => {
        if (part["type"] !== "text" || !isString(part["text"])) return part;
        const key = i * 100000 + p + 1;
        const replacement = deduped.get(key);
        if (replacement !== undefined) {
          changed = true;
          return { ...part, text: replacement };
        }
        return part;
      });
      return changed ? { ...msg, content: newContent } : { ...msg };
    }

    return { ...msg };
  });

  return { messages: result, dedupCount };
}

const SESSION_DEDUP_SCHEMA = [
{
  key: "enabled",
  type: "boolean",
  label: "Enabled",
  defaultValue: true
},
{
  key: "minBlockChars",
  type: "number",
  label: "Minimum block characters",
  description: "Minimum character count for a suffix block to be a dedup candidate.",
  defaultValue: DEFAULT_MIN_BLOCK_CHARS,
  min: 1,
  max: 100000
},
{
  key: "fuzzy",
  type: "boolean",
  label: "Fuzzy near-duplicate dedup",
  description:
  "Opt-in: replace whole messages ~85%+ similar to an earlier one with a recoverable CCR marker.",
  defaultValue: false
}];


function validateSessionDedupConfig(config) {
  const errors = [];
  if (config["enabled"] !== undefined && !isBoolean(config["enabled"])) {
    errors.push("enabled must be a boolean");
  }
  if (config["minBlockChars"] !== undefined) {
    const v = config["minBlockChars"];
    if (!isNumber(v) || !Number.isFinite(v) || v < 1) {
      errors.push("minBlockChars must be a positive number");
    }
  }
  if (config["fuzzy"] !== undefined) {
    const f = config["fuzzy"];
    if (isObject(f) && f !== null) {
      const fe = f["enabled"];
      if (fe !== undefined && !isBoolean(fe)) errors.push("fuzzy.enabled must be a boolean");
    } else if (!isBoolean(f)) {
      errors.push("fuzzy must be an object { enabled } or a boolean");
    }
  }
  return { valid: errors.length === 0, errors };
}

export const sessionDedupEngine = {
  id: ENGINE_ID,
  name: "Session Dedup",
  description:
  "Content-addressed cross-turn deduplication: replaces repeated multi-line blocks " +
  "with short reference markers (R11/N2/TO1, TokenMizer blueprint).",
  icon: "content_copy",
  targets: ["messages"],
  stackable: true,
  stackPriority: 3,
  metadata: {
    id: ENGINE_ID,
    name: "Session Dedup",
    description:
    "Content-addressed cross-turn deduplication: replaces repeated multi-line blocks with short reference markers.",
    inputScope: "messages",
    targetLatencyMs: 1,
    supportsPreview: true,
    stable: true
  },

  apply(body, options) {
    const stepConfig = options?.stepConfig ?? {};

    if (stepConfig["enabled"] === false) {
      return { body, compressed: false, stats: null };
    }

    const minBlockChars =
    isNumber(stepConfig["minBlockChars"]) ?
    stepConfig["minBlockChars"] :
    DEFAULT_MIN_BLOCK_CHARS;

    const messages = body["messages"];
    if (!Array.isArray(messages) || messages.length === 0) {
      return { body, compressed: false, stats: null };
    }

    const start = performance.now();
    const { messages: exactMessages, dedupCount } = processMessages(messages, minBlockChars);

    const { messages: finalMessages, fuzzyCount } = runFuzzyPass(
      exactMessages,
      stepConfig,
      minBlockChars,
      options?.principalId
    );

    if (dedupCount + fuzzyCount === 0) {
      return { body, compressed: false, stats: null };
    }

    const newBody = { ...body, messages: finalMessages };
    const durationMs = Math.round(performance.now() - start);
    const techniques = ["session-dedup"];
    if (fuzzyCount > 0) techniques.push("fuzzy-dedup");
    const rules = [];
    if (dedupCount > 0) rules.push(`deduplicated-${dedupCount}-blocks`);
    if (fuzzyCount > 0) rules.push(`fuzzy-${fuzzyCount}-blocks`);
    const stats = createCompressionStats(body, newBody, "stacked", techniques, rules, durationMs);
    return { body: newBody, compressed: true, stats };
  },

  compress(body, config) {
    return this.apply(body, { stepConfig: config ?? {} });
  },

  getConfigSchema() {
    return SESSION_DEDUP_SCHEMA;
  },

  validateConfig(config) {
    return validateSessionDedupConfig(config);
  }
};