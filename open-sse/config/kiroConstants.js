/**
 * Kiro-specific constants and helpers.
 *
 * Mirrors the behaviour of `internal/translator/kiro/common/constants.go` and
 * `internal/translator/kiro/claude/kiro_claude_request.go` from the
 * CLIProxyAPIPlus reference implementation, scoped down to what 9router needs:
 *
 *   - `-agentic` model suffix detection + chunked-write system prompt
 *   - reasoning / thinking trigger detection (Anthropic-Beta header,
 *     Claude `thinking`, OpenAI `reasoning_effort`, AMP/Cursor magic tag)
 *   - the `<thinking_mode>enabled</thinking_mode>` system-prompt injection
 *     that turns Kiro reasoning on
 *
 * Kiro upstream does not advertise `-agentic` model IDs; they are a 9router
 * fiction. The suffix is stripped before the request leaves this process.
 */

import { extractThinking, parseSuffix } from "../translator/concerns/thinkingUnified.js";
import { assertValidAwsRegion } from "../../src/lib/oauth/constants/oauth.js";
import { effortToBudget } from "../translator/concerns/thinking.js";
import {
  resolveKiroRegion as resolveKiroRegionFromCredentials,
  alignProfileArnRegion,
  KIRO_DEFAULT_REGION,
  normalizeKiroRegion,
} from "./kiroRegions.js";

// Backwards-compat shim: legacy callers (and tests) pass the region as
// a string. The current `resolveKiroRegion(credentials)` in kiroRegions.js
// expects a credentials object. This wrapper accepts a string (passed
// through, trimmed) or an object (delegates to the new function), and
// returns the default region on null/undefined/empty.
export function resolveKiroRegion(arg) {
  if (typeof arg === "string") {
    const t = arg.trim();
    return normalizeKiroRegion(t || KIRO_DEFAULT_REGION);
  }
  if (arg && typeof arg === "object") {
    return resolveKiroRegionFromCredentials(arg);
  }
  return KIRO_DEFAULT_REGION;
}

// Re-export region helpers so existing importers of kiroConstants keep working
// and there is one obvious place to find all Kiro request-shaping helpers.
export {
  alignProfileArnRegion,
  buildKiroBaseUrls,
  buildKiroProfileEndpoint,
  buildKiroOidcEndpoint,
  regionFromProfileArn,
  KIRO_DEFAULT_REGION,
} from "./kiroRegions.js";

export const KIRO_AGENTIC_SUFFIX = "-agentic";
export const KIRO_THINKING_SUFFIX = "-thinking";

export const KIRO_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "additionalProperties",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "if",
  "then",
  "else",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentEncoding",
  "contentMediaType",
]);

function cleanKiroSchemaValue(value) {
  if (Array.isArray(value)) return value.map(cleanKiroSchemaValue);
  if (!value || typeof value !== "object") return value;

  const cleaned = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === "properties" || key === "patternProperties")
      && child && typeof child === "object" && !Array.isArray(child)) {
      cleaned[key] = Object.fromEntries(
        Object.entries(child).map(([name, schema]) => [name, cleanKiroSchemaValue(schema)])
      );
    } else if (!KIRO_UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      cleaned[key] = cleanKiroSchemaValue(child);
    }
  }
  return cleaned;
}

/**
 * Convert a client JSON Schema into Kiro's supported object-schema subset.
 * Root combinators are flattened so their properties survive; unsupported
 * schema keywords are removed recursively without treating property names as keywords.
 */
export function normalizeKiroToolSchema(schema) {
  const source = schema && typeof schema === "object"
    ? structuredClone(schema)
    : {};
  const rootBranches = ["allOf", "oneOf", "anyOf"].map((keyword) => [
    keyword,
    Array.isArray(source[keyword]) ? source[keyword] : [],
  ]);
  for (const [keyword] of rootBranches) delete source[keyword];

  const cleaned = cleanKiroSchemaValue(source);
  cleaned.type = "object";
  if (!cleaned.properties || typeof cleaned.properties !== "object" || Array.isArray(cleaned.properties)) {
    cleaned.properties = {};
  }

  const required = new Set(Array.isArray(cleaned.required) ? cleaned.required : []);
  for (const [keyword, schemas] of rootBranches) {
    const branches = schemas.map(normalizeKiroToolSchema);
    for (const branch of branches) {
      for (const [name, property] of Object.entries(branch.properties)) {
        if (!Object.hasOwn(cleaned.properties, name)) cleaned.properties[name] = property;
      }
    }

    if (keyword === "allOf") {
      for (const branch of branches) {
        for (const name of branch.required || []) required.add(name);
      }
    } else if (branches.length > 0) {
      const common = new Set(branches[0].required || []);
      for (const branch of branches.slice(1)) {
        for (const name of common) {
          if (!(branch.required || []).includes(name)) common.delete(name);
        }
      }
      for (const name of common) required.add(name);
    }
  }

  cleaned.required = [...required].filter(
    (name) => typeof name === "string" && Object.hasOwn(cleaned.properties, name)
  );
  return cleaned;
}

// Public default CodeWhisperer profile ARNs (us-east-1), keyed by auth method.
// Used when an account cannot resolve its own profileArn. Builder ID and social
// (Google/GitHub) sign-ins map to different shared profiles.
export const KIRO_DEFAULT_PROFILE_ARNS = {
  "builder-id": "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX",
  social: "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
};

// Back-compat single default (Builder ID).
export const KIRO_DEFAULT_PROFILE_ARN = KIRO_DEFAULT_PROFILE_ARNS["builder-id"];

/** Resolve the shared default profileArn for a given auth method. */
export function resolveDefaultProfileArn(authMethod) {
  const social = authMethod === "google" || authMethod === "github";
  return social ? KIRO_DEFAULT_PROFILE_ARNS.social : KIRO_DEFAULT_PROFILE_ARNS["builder-id"];
}

// ─── Regional CodeWhisperer endpoints ───────────────────────────────────────
// Kiro historically assumed us-east-1 everywhere. IAM Identity Center (IdC)
// accounts can be homed in another region (e.g. eu-central-1); their token is
// rejected with 403 "bearer token invalid" by the us-east-1 endpoints, and
// their CodeWhisperer profile is only visible from the regional Amazon Q host.
// These helpers thread `providerSpecificData.region` through, defaulting to
// us-east-1 so existing Builder ID / social accounts are unaffected.

/**
 * Data-plane (generateAssistantResponse) URL for a region.
 * Returns null for us-east-1 so callers keep the historical registry baseUrls
 * (runtime.kiro.dev → codewhisperer → q). Other regions use the regional
 * Amazon Q endpoint, the only host that resolves + accepts their token.
 */
export function resolveKiroDataPlaneUrl(region) {
  const r = resolveKiroRegion(region);
  if (r === KIRO_DEFAULT_REGION) return null;
  assertValidAwsRegion(r);
  return `https://q.${r}.amazonaws.com/generateAssistantResponse`;
}

/**
 * Control-plane host (ListAvailableProfiles / GetUsageLimits) for a region.
 * us-east-1 keeps the historical codewhisperer host; other regions use the
 * regional Amazon Q host.
 */
export function resolveKiroControlPlaneHost(region) {
  const r = resolveKiroRegion(region);
  // This host carries bearer/API-key credentials. Never interpolate an
  // untrusted stored region without the same validation as the data plane.
  assertValidAwsRegion(r);
  return r === KIRO_DEFAULT_REGION
    ? "https://codewhisperer.us-east-1.amazonaws.com"
    : `https://q.${r}.amazonaws.com`;
}

/**
 * Resolve the profileArn to send with a Kiro request, always aligned to the
 * credential's region. This is the single place that decides which profileArn
 * (if any) a request carries:
 *
 *   - a stored profileArn      → returned VERBATIM. The profile's own region is
 *                                authoritative: a Q Developer profile can live
 *                                in a different region than the IAM Identity
 *                                Center that minted the token (e.g. IDC
 *                                eu-north-1, profile eu-central-1). Rewriting
 *                                the region here corrupts valid Org ARNs → 400
 *                                "Improperly formed request". The data plane is
 *                                routed off the ARN region by the executor.
 *   - no ARN, api_key auth     → "" (api keys must use their own account ARN;
 *                                the shared default would 403)
 *   - no ARN, us-east-1        → the shared builder-id/social default ARN
 *   - no ARN, other region     → "" (no shared default exists outside us-east-1;
 *                                the ARN is resolved at request time instead)
 *
 * @param {object} credentials Connection record with providerSpecificData
 * @returns {string} profileArn or "" when none should be sent
 */
export function resolveKiroProfileArn(credentials) {
  const psd = credentials?.providerSpecificData || {};
  if (psd.profileArn) return psd.profileArn;
  if (psd.authMethod === "api_key") return "";
  const r = resolveKiroRegion(credentials);
  if (r === KIRO_DEFAULT_REGION) return resolveDefaultProfileArn(psd.authMethod);
  return "";
}

export const KIRO_THINKING_BUDGET_DEFAULT = 16000;

export const KIRO_AGENTIC_SYSTEM_PROMPT = `
# CRITICAL: CHUNKED WRITE PROTOCOL (MANDATORY)

You MUST follow these rules for ALL file operations. Violation causes server timeouts and task failure.

## ABSOLUTE LIMITS
- **MAXIMUM 350 LINES** per single write/edit operation - NO EXCEPTIONS
- **RECOMMENDED 300 LINES** or less for optimal performance
- **NEVER** write entire files in one operation if >300 lines

## MANDATORY CHUNKED WRITE STRATEGY

### For NEW FILES (>300 lines total):
1. FIRST: Write initial chunk (first 250-300 lines) using write_to_file/fsWrite
2. THEN: Append remaining content in 250-300 line chunks using file append operations
3. REPEAT: Continue appending until complete

### For EDITING EXISTING FILES:
1. Use surgical edits (apply_diff/targeted edits) - change ONLY what's needed
2. NEVER rewrite entire files - use incremental modifications
3. Split large refactors into multiple small, focused edits

### For LARGE CODE GENERATION:
1. Generate in logical sections (imports, types, functions separately)
2. Write each section as a separate operation
3. Use append operations for subsequent sections

## EXAMPLES OF CORRECT BEHAVIOR

CORRECT: Writing a 600-line file
- Operation 1: Write lines 1-300 (initial file creation)
- Operation 2: Append lines 301-600

CORRECT: Editing multiple functions
- Operation 1: Edit function A
- Operation 2: Edit function B
- Operation 3: Edit function C

WRONG: Writing 500 lines in single operation -> TIMEOUT
WRONG: Rewriting entire file to change 5 lines -> TIMEOUT
WRONG: Generating massive code blocks without chunking -> TIMEOUT

## WHY THIS MATTERS
- Server has 2-3 minute timeout for operations
- Large writes exceed timeout and FAIL completely
- Chunked writes are FASTER and more RELIABLE
- Failed writes waste time and require retry

REMEMBER: When in doubt, write LESS per operation. Multiple small operations > one large operation.
`.trim();

/**
 * Resolve the Kiro thinking budget requested by a client.
 *
 * Reuses the shared thinkingUnified parser (extractThinking) so every client
 * shape (Claude output_config.effort / thinking.budget_tokens, OpenAI
 * reasoning_effort / reasoning.effort, Gemini, Qwen) maps consistently. Explicit
 * `none`/`off`/disabled wins and returns null (no prefix injected).
 * buildThinkingSystemPrefix performs Kiro's final 1..32000 clamp.
 *
 * @param {object} body OpenAI/Claude-shaped request body
 * @param {object} [headers] Original inbound HTTP headers (case-insensitive)
 * @param {string} [model] Model id the caller asked for
 * @param {object|null} [intent] Pre-parsed request-scoped thinking override
 * @returns {number|null} budget to inject, or null when thinking is disabled
 */
export function resolveKiroThinkingBudget(body, headers, model, intent = null) {
  // A model suffix is an explicit client choice, so it must win over body,
  // header, tag, and legacy model-name heuristics. In particular `(none)`
  // suppresses all of those fallbacks.
  const parsedModel = parseSuffix(model);
  const cfg = intent ?? parsedModel.override ?? extractThinking(body);
  if (cfg) {
    if (cfg.mode === "none") return null;
    if (cfg.mode === "budget") return cfg.budget;
    if (cfg.mode === "level") return effortToBudget(cfg.level) ?? KIRO_THINKING_BUDGET_DEFAULT;
    return KIRO_THINKING_BUDGET_DEFAULT;
  }

  if (headers) {
    const beta = pickHeader(headers, "anthropic-beta");
    if (typeof beta === "string" && beta.toLowerCase().includes("interleaved-thinking")) {
      return KIRO_THINKING_BUDGET_DEFAULT;
    }
  }

  if (containsThinkingModeTag(body)) return KIRO_THINKING_BUDGET_DEFAULT;

  if (typeof model === "string" && model) {
    const hasOpaqueSuffix = /\([^()]+\)\s*$/.test(model) && !parsedModel.override;
    if (!hasOpaqueSuffix) {
      const m = parsedModel.cleanModel.toLowerCase();
      if (m.includes("thinking") || m.includes("-reason")) return KIRO_THINKING_BUDGET_DEFAULT;
    }
  }

  return null;
}

/**
 * Detect whether an inbound request is asking for reasoning / thinking output.
 * Thin wrapper over resolveKiroThinkingBudget (single source of truth).
 *
 * @param {object} body OpenAI-shaped request body (post-translation)
 * @param {object} [headers] Original inbound HTTP headers (case-insensitive)
 * @param {string} [model] Model id the caller asked for (post-strip ok)
 * @returns {boolean}
 */
export function isThinkingEnabled(body, headers, model, intent = null) {
  return resolveKiroThinkingBudget(body, headers, model, intent) !== null;
}

/**
 * Detect whether a model id refers to a 9router synthetic agentic variant.
 * Agentic variants share the same upstream model as the base; the only
 * difference is the chunked-write system prompt this module injects.
 *
 * @param {string} model
 * @returns {boolean}
 */
export function isAgenticModel(model) {
  return typeof model === "string" && model.endsWith(KIRO_AGENTIC_SUFFIX);
}

/**
 * Strip the `-agentic` suffix from a model id, leaving the upstream-real id.
 *
 * @param {string} model
 * @returns {string}
 */
export function stripAgenticSuffix(model) {
  if (!isAgenticModel(model)) return model;
  return model.slice(0, -KIRO_AGENTIC_SUFFIX.length);
}

/**
 * Detect whether a model id is a 9router synthetic thinking variant
 * (e.g. `claude-sonnet-4.5-thinking`). Same upstream model as the base; the
 * only difference is `<thinking_mode>enabled</thinking_mode>` injection.
 *
 * Note: real Kiro thinking-capable variants exist (e.g. `kimi-k2-thinking` in
 * other providers), but for the `kr/` namespace there is no `-thinking`
 * model on Kiro upstream. Treat the suffix as a synthetic alias.
 *
 * @param {string} model Model id with `-agentic` already stripped
 * @returns {boolean}
 */
export function isThinkingModel(model) {
  return typeof model === "string" && model.endsWith(KIRO_THINKING_SUFFIX);
}

/**
 * Strip the `-thinking` suffix from a model id.
 *
 * @param {string} model
 * @returns {string}
 */
export function stripThinkingSuffix(model) {
  if (!isThinkingModel(model)) return model;
  return model.slice(0, -KIRO_THINKING_SUFFIX.length);
}

/**
 * Resolve a 9router model id to the real upstream Kiro model id, plus flags
 * describing which behaviours the suffixes implied.
 *
 *   resolveKiroModel("claude-sonnet-4.5-thinking-agentic")
 *     => { upstream: "claude-sonnet-4.5", agentic: true, thinking: true }
 *   resolveKiroModel("claude-sonnet-4.5-thinking")
 *     => { upstream: "claude-sonnet-4.5", agentic: false, thinking: true }
 *   resolveKiroModel("claude-sonnet-4.5-agentic")
 *     => { upstream: "claude-sonnet-4.5", agentic: true, thinking: false }
 *   resolveKiroModel("claude-sonnet-4.5")
 *     => { upstream: "claude-sonnet-4.5", agentic: false, thinking: false }
 *
 * @param {string} model
 * @returns {{ upstream: string, agentic: boolean, thinking: boolean }}
 */
export function resolveKiroModel(model) {
  let upstream = model;
  let agentic = false;
  let thinking = false;
  if (isAgenticModel(upstream)) {
    agentic = true;
    upstream = stripAgenticSuffix(upstream);
  }
  if (isThinkingModel(upstream)) {
    thinking = true;
    upstream = stripThinkingSuffix(upstream);
  }
  return { upstream, agentic, thinking };
}

/**
 * Build the magic system-prompt prefix that turns Kiro reasoning on.
 * Same shape as CLIProxyAPIPlus.
 *
 * @param {number} [budget=KIRO_THINKING_BUDGET_DEFAULT]
 */
export function buildThinkingSystemPrefix(budget = KIRO_THINKING_BUDGET_DEFAULT) {
  const safeBudget = Math.max(1, Math.min(32000, Number(budget) || KIRO_THINKING_BUDGET_DEFAULT));
  return `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>${safeBudget}</max_thinking_length>`;
}

function pickHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") {
    return headers.get(name);
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return undefined;
}

function containsThinkingModeTag(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role !== "system" && msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string") {
      if (containsTagInText(content)) return true;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const text = part?.text;
        if (typeof text === "string" && containsTagInText(text)) return true;
      }
    }
  }
  if (typeof body?.system === "string" && containsTagInText(body.system)) return true;
  return false;
}

function containsTagInText(text) {
  if (!text) return false;
  if (!text.includes("<thinking_mode>")) return false;
  return text.includes("<thinking_mode>enabled</thinking_mode>")
    || text.includes("<thinking_mode>interleaved</thinking_mode>");
}
