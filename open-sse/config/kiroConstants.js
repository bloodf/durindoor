/**
 * Kiro request-shaping helpers that depend on translator/OAuth modules, plus
 * re-exports of the canonical Kiro constants and region helpers from the
 * registry entry (`open-sse/providers/registry/kiro.js`).
 */

import { extractThinking, parseSuffix } from "../translator/concerns/thinkingUnified.js";
import { assertValidAwsRegion } from "./awsRegion.js";
import { effortToBudget } from "../translator/concerns/thinking.js";
import {
  resolveKiroRegion as resolveKiroRegionFromCredentials,
  KIRO_DEFAULT_REGION,
  normalizeKiroRegion,
  resolveDefaultProfileArn,
  KIRO_THINKING_BUDGET_DEFAULT,
  pickKiroHeader,
  containsKiroThinkingModeTag,
} from "../providers/registry/kiro.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

export {
  KIRO_IDE_VERSION,
  KIRO_RUNTIME_SDK_VERSION,
  KIRO_AGENT_OS,
  KIRO_AGENT_OS_VERSION,
  KIRO_NODE_VERSION,
  KIRO_DEFAULT_REGION,
  normalizeKiroRegion,
  regionFromProfileArn,
  alignProfileArnRegion,
  buildKiroBaseUrls,
  buildKiroProfileEndpoint,
  buildKiroOidcEndpoint,
  KIRO_TOOL_CALL_REPAIR_INSTRUCTION,
  KIRO_MAX_TOOL_CALL_REPAIR_ATTEMPTS,
  KIRO_MAX_TOOL_CALL_WRAPPER_BYTES,
  KIRO_AGENTIC_SUFFIX,
  KIRO_THINKING_SUFFIX,
  KIRO_UNSUPPORTED_SCHEMA_KEYS,
  normalizeKiroToolSchema,
  KIRO_DEFAULT_PROFILE_ARNS,
  KIRO_DEFAULT_PROFILE_ARN,
  resolveDefaultProfileArn,
  KIRO_THINKING_BUDGET_DEFAULT,
  KIRO_UNSUPPORTED_THINKING_FIELDS,
  KIRO_AGENTIC_SYSTEM_PROMPT,
  isAgenticModel,
  stripAgenticSuffix,
  isThinkingModel,
  stripThinkingSuffix,
  normalizeKiroUpstreamModelId,
  resolveKiroModel,
  buildThinkingSystemPrefix,
} from "../providers/registry/kiro.js";

// Backwards-compat shim: legacy callers (and tests) pass the region as
// a string. The current `resolveKiroRegion(credentials)` in registry/kiro.js
// expects a credentials object.
export function resolveKiroRegion(arg) {
  if (isString(arg)) {
    const t = arg.trim();
    return normalizeKiroRegion(t || KIRO_DEFAULT_REGION);
  }
  if (arg && isObject(arg)) {
    return resolveKiroRegionFromCredentials(arg);
  }
  return KIRO_DEFAULT_REGION;
}

export function resolveKiroDataPlaneUrl(region) {
  const r = resolveKiroRegion(region);
  if (r === KIRO_DEFAULT_REGION) return null;
  assertValidAwsRegion(r);
  return `https://q.${r}.amazonaws.com/generateAssistantResponse`;
}

export function resolveKiroControlPlaneHost(region) {
  const r = resolveKiroRegion(region);
  assertValidAwsRegion(r);
  return r === KIRO_DEFAULT_REGION
    ? "https://codewhisperer.us-east-1.amazonaws.com"
    : `https://q.${r}.amazonaws.com`;
}

export function resolveKiroProfileArn(credentials) {
  const psd = credentials?.providerSpecificData || {};
  if (psd.profileArn) return psd.profileArn;
  if (psd.authMethod === "api_key") return "";
  const r = resolveKiroRegion(credentials);
  if (r === KIRO_DEFAULT_REGION) return resolveDefaultProfileArn(psd.authMethod);
  return "";
}

export function resolveKiroThinkingBudget(body, headers, model, intent = null) {
  const parsedModel = parseSuffix(model);
  const cfg = intent ?? parsedModel.override ?? extractThinking(body);
  if (cfg) {
    if (cfg.mode === "none") return null;
    if (cfg.mode === "budget") return cfg.budget;
    if (cfg.mode === "level") return effortToBudget(cfg.level) ?? KIRO_THINKING_BUDGET_DEFAULT;
    return KIRO_THINKING_BUDGET_DEFAULT;
  }

  if (headers) {
    const beta = pickKiroHeader(headers, "anthropic-beta");
    if (isString(beta) && beta.toLowerCase().includes("interleaved-thinking")) {
      return KIRO_THINKING_BUDGET_DEFAULT;
    }
  }

  if (containsKiroThinkingModeTag(body)) return KIRO_THINKING_BUDGET_DEFAULT;

  if (isString(model) && model) {
    const hasOpaqueSuffix = /\([^()]+\)\s*$/.test(model) && !parsedModel.override;
    if (!hasOpaqueSuffix) {
      const m = parsedModel.cleanModel.toLowerCase();
      if (m.includes("thinking") || m.includes("-reason")) return KIRO_THINKING_BUDGET_DEFAULT;
    }
  }

  return null;
}

export function isThinkingEnabled(body, headers, model, intent = null) {
  return resolveKiroThinkingBudget(body, headers, model, intent) !== null;
}
