// Compression fidelity gate.
//
// Ported from OmniRoute open-sse/services/compression/fidelityGate.ts
// (diegosouzapw/OmniRoute@61e07fb7, MIT) and extended with structural
// protected-block checks that OmniRoute leaves to each engine.
//
// Two layers:
//   checkProtectedBlocks(inputBody, outputBody)
//     Structural. Tool schemas, non-text parts (images, PDFs/documents, audio,
//     tool calls, thinking blocks), anything carrying a signature, error tool
//     results, system/developer instructions and fenced code blocks must survive
//     byte-identical. Every unique protected item in the input must still exist
//     in the output (set semantics, so a dedup engine may drop a later copy).
//   checkFidelity(inputText, outputText, cfg)
//     Text invariants from OmniRoute: protected tokens (URLs, identifiers,
//     paths, inline code), diff hunks, numbers, JSON keys. Adds a negation-count
//     invariant so "do not" can never become "do".
//
// Both return { passed, failedInvariant?, detail? }. Both fail OPEN on an
// internal error: a verifier bug must never block a request.

import { extractPreservedBlocks, findFencedCodeBlocks } from "./preservation.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

const CRITICAL_KINDS = new Set([
  "url",
  "const_case",
  "env_var",
  "version",
  "dotted_identifier",
  "function_call",
  "file_path",
  "inline_code"
]);

// Anti-ReDoS: every quantifier is bounded (same expressions as OmniRoute).
const NUMERIC_RE = /\d[\d.,]{0,40}/g;
const JSON_KEY_RE = /"([A-Za-z_$][\w$-]{0,80})"\s*:/g;
const HUNK_RE = /@@ -\d{1,9}(?:,\d{1,9})? \+\d{1,9}(?:,\d{1,9})? @@/g;
// Negation markers across the shipped language packs (en, pt, es, de, fr, id)
// plus CJK forms. Word-bounded for Latin scripts.
const NEGATION_RE =
/\b(?:not|never|no|none|nothing|cannot|can't|don't|doesn't|didn't|won't|isn't|aren't|wasn't|shouldn't|mustn't|não|nunca|nenhum|nenhuma|nada|nem|jamais|ningún|ninguna|nicht|nie|kein|keine|niemals|ne|pas|jamais|tidak|bukan|jangan)\b|ない|ません|不|没/gi;

const TEXT_PART_TYPES = new Set(["text", "input_text", "output_text"]);
// Non-text content part types that compression must never rewrite.
const PROTECTED_PART_TYPES = new Set([
"image",
"image_url",
"input_image",
"document",
"file",
"input_file",
"input_audio",
"audio",
"thinking",
"redacted_thinking",
"reasoning",
"tool_use",
"server_tool_use",
"function",
"function_call",
"custom_tool_call"]
);
// Gemini parts and signature carriers have no `type`, so match by key.
const PROTECTED_KEYS = ["inlineData", "fileData", "functionCall", "signature", "thoughtSignature", "thought_signature", "encrypted_content"];
const SCHEMA_KEYS = ["tools", "functions", "tool_choice", "response_format", "text"];
const INSTRUCTION_ROLES = new Set(["system", "developer"]);

function uniq(values) {
  return Array.from(new Set(values));
}

function survivalRatio(needles, haystack) {
  if (needles.length === 0) return 1;
  let survived = 0;
  for (const n of needles) if (haystack.includes(n)) survived++;
  return survived / needles.length;
}

function isErrorResult(node) {
  return node.is_error === true || node.isError === true || node.status === "error";
}

function isProtectedNode(node) {
  if (isString(node.type) && PROTECTED_PART_TYPES.has(node.type)) return true;
  if (isErrorResult(node)) return true;
  if (INSTRUCTION_ROLES.has(node.role)) return true;
  return PROTECTED_KEYS.some((key) => key in node);
}

/** Every string reachable from the body, in document order. */
function collectStrings(node, out) {
  if (isString(node)) {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
  } else if (node && isObject(node)) {
    for (const value of Object.values(node)) collectStrings(value, out);
  }
  return out;
}

/**
 * Flatten every message-ish string in a body to one text blob. Covers chat
 * `messages`, Responses `input`/`instructions`, Claude `system`, Gemini
 * `contents` and Kiro `conversationState`. Schema keys are excluded because
 * they are checked structurally.
 */
export function bodyToText(body) {
  if (!body || !isObject(body)) return "";
  const parts = [];
  for (const key of ["system", "instructions", "messages", "input", "contents", "systemInstruction", "conversationState"]) {
    if (key in body) collectStrings(body[key], parts);
  }
  return parts.join("\n");
}

// Collect protected items WITHOUT serializing them: nodes by reference, fenced
// code with the string slot it came from. checkProtectedBlocks serializes only
// what did not survive by reference, so large unchanged media (base64 images)
// is never stringified on the hot path.
function collectProtected(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectProtected(item, out);
    return out;
  }
  if (!node || !isObject(node)) return out;
  if (isProtectedNode(node)) {
    out.nodes.add(node);
    return out; // the whole subtree is pinned; no need to descend
  }
  const addCode = (slot) => {
    for (const block of findFencedCodeBlocks(slot)) out.code.push({ block, slot });
  };
  if (TEXT_PART_TYPES.has(node.type) && isString(node.text)) {
    addCode(node.text);
    return out;
  }
  for (const value of Object.values(node)) {
    if (isString(value)) addCode(value);
    else collectProtected(value, out);
  }
  return out;
}

const protectedSets = () => ({ nodes: new Set(), code: [] });

/**
 * Structural protected-block check. Returns the first failing invariant.
 * @returns {{passed: boolean, failedInvariant?: string, detail?: string}}
 */
export function checkProtectedBlocks(inputBody, outputBody) {
  try {
    if (!inputBody || !isObject(inputBody)) return { passed: true };
    if (!outputBody || !isObject(outputBody)) {
      return { passed: false, failedInvariant: "body", detail: "output body is not an object" };
    }
    const same = (key) => inputBody[key] === outputBody[key] || JSON.stringify(inputBody[key]) === JSON.stringify(outputBody[key]);
    for (const key of SCHEMA_KEYS) {
      if (key === "text" && !isObject(inputBody.text)) continue; // Responses text.format only
      if (!same(key)) return { passed: false, failedInvariant: "tool-schemas", detail: `${key} changed` };
    }
    for (const key of ["system", "instructions", "systemInstruction"]) {
      if (!same(key)) return { passed: false, failedInvariant: "instructions", detail: `${key} changed` };
    }
    const before = collectProtected(inputBody, protectedSets());
    if (before.nodes.size === 0 && before.code.length === 0) return { passed: true };
    const after = collectProtected(outputBody, protectedSets());

    let afterJson = null; // lazily: serialized output nodes that are not shared refs
    for (const node of before.nodes) {
      if (after.nodes.has(node)) continue;
      afterJson ??= new Set(Array.from(after.nodes, (n) => before.nodes.has(n) ? null : JSON.stringify(n)));
      const json = JSON.stringify(node);
      if (!afterJson.has(json)) {
        return { passed: false, failedInvariant: "protected-blocks", detail: `protected block altered: ${json.slice(0, 80)}` };
      }
    }

    if (before.code.length > 0) {
      const outputStrings = collectStrings(outputBody, []);
      const unchangedSlots = new Set(outputStrings);
      let outputText = null;
      for (const { block, slot } of before.code) {
        if (unchangedSlots.has(slot)) continue; // slot survived verbatim
        outputText ??= outputStrings.join("\n");
        // Fenced code may move between string slots; it must survive verbatim somewhere.
        if (!outputText.includes(block)) {
          return { passed: false, failedInvariant: "protected-blocks", detail: `protected code altered: ${block.slice(0, 80)}` };
        }
      }
    }
    return { passed: true };
  } catch {
    return { passed: true };
  }
}

// Counted over unique lines, so dropping a duplicate block (session-dedup)
// is not mistaken for removing a negation.
function countNegations(text) {
  return (uniq(text.split("\n")).join("\n").match(NEGATION_RE) ?? []).length;
}

/**
 * Deterministic text fidelity check. Cheap → expensive; first failure wins.
 * @param {string} inputText
 * @param {string} outputText
 * @param {{minTokenSurvivalPercent?: number, minJsonKeyPercent?: number,
 *          checkNumericIntegrity?: boolean, checkDiffHunks?: boolean,
 *          checkNegations?: boolean}} [cfg]
 */
export function checkFidelity(inputText, outputText, cfg = {}) {
  try {
    const tokens = uniq(
      extractPreservedBlocks(inputText).
      blocks.filter((b) => CRITICAL_KINDS.has(b.kind)).
      map((b) => b.content.trim()).
      filter((c) => c.length > 0)
    );
    const minTok = (cfg.minTokenSurvivalPercent ?? 95) / 100;
    const tokRatio = survivalRatio(tokens, outputText);
    if (tokRatio < minTok) {
      return {
        passed: false,
        failedInvariant: "protected-tokens",
        detail: `protected tokens ${Math.round(tokRatio * 100)}% < ${Math.round(minTok * 100)}%`
      };
    }

    if (cfg.checkNegations !== false && countNegations(outputText) < countNegations(inputText)) {
      return { passed: false, failedInvariant: "negation", detail: "negation marker removed" };
    }

    if (cfg.checkDiffHunks !== false) {
      for (const h of uniq(inputText.match(HUNK_RE) ?? [])) {
        if (!outputText.includes(h)) {
          return { passed: false, failedInvariant: "diff-hunks", detail: `hunk "${h}" missing` };
        }
      }
    }

    if (cfg.checkNumericIntegrity !== false) {
      // Trailing "." / "," is sentence punctuation, not part of the number.
      for (const num of uniq((inputText.match(NUMERIC_RE) ?? []).map((n) => n.replace(/[.,]+$/, "")))) {
        if (!outputText.includes(num)) {
          return { passed: false, failedInvariant: "numeric", detail: `number "${num}" missing` };
        }
      }
    }

    const keys = uniq(Array.from(inputText.matchAll(JSON_KEY_RE), (m) => m[1]));
    if (keys.length > 0) {
      const minKey = (cfg.minJsonKeyPercent ?? 90) / 100;
      const keyRatio = survivalRatio(keys.map((k) => `"${k}"`), outputText);
      if (keyRatio < minKey) {
        return {
          passed: false,
          failedInvariant: "json-keys",
          detail: `JSON keys ${Math.round(keyRatio * 100)}% < ${Math.round(minKey * 100)}%`
        };
      }
    }

    return { passed: true };
  } catch {
    return { passed: true };
  }
}

/**
 * Per-step gate used by the compression seam. Structural protection always
 * applies; text invariants apply only when `textInvariants` is true.
 */
export function gateStep(inputBody, outputBody, { textInvariants = false, ...cfg } = {}) {
  const structural = checkProtectedBlocks(inputBody, outputBody);
  if (!structural.passed || !textInvariants) return structural;
  return checkFidelity(bodyToText(inputBody), bodyToText(outputBody), cfg);
}
