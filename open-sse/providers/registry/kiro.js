import {
  KIRO_GPT_5_6_FAMILY,
  buildKiroGpt56Variants,
  buildKiroModelVariants,
} from "../models/kiroVariants.js";
import { isFunction, isObject, isString } from "../../../src/shared/utils/typeChecks.js";

// Stable IDE release from the official update metadata (2026-11-10):
// https://prod.download.desktop.kiro.dev/stable/metadata-linux-x64-stable.json
export const KIRO_IDE_VERSION = "1.4.154";
export const KIRO_RUNTIME_SDK_VERSION = "1.0.0";
export const KIRO_AGENT_OS = "windows";
export const KIRO_AGENT_OS_VERSION = "10.0.26200";
export const KIRO_NODE_VERSION = "22.21.1";

export const KIRO_DEFAULT_REGION = "us-east-1";
const KIRO_REGION_PATTERN = /^[a-z]{2}(?:-[a-z0-9]+)+-\d{1,2}$/;
const GENERATE_PATH = "/generateAssistantResponse";

const KIRO_RUNTIME_HOSTS = [
  { host: (r) => `runtime.${r}.kiro.dev`, availableIn: "all" },
  { host: (r) => `codewhisperer.${r}.amazonaws.com`, availableIn: [KIRO_DEFAULT_REGION] },
  { host: (r) => `q.${r}.amazonaws.com`, availableIn: "all" },
];

function hostAvailable(entry, region) {
  return entry.availableIn === "all" || entry.availableIn.includes(region);
}

export function normalizeKiroRegion(region) {
  const normalized = isString(region) ? region.trim().toLowerCase() : "";
  if (!KIRO_REGION_PATTERN.test(normalized)) {
    throw new Error("Invalid Kiro AWS region");
  }
  return normalized;
}

/** Extract the AWS region from a CodeWhisperer profileArn, or null if absent. */
export function regionFromProfileArn(profileArn) {
  if (!isString(profileArn)) return null;
  const parts = profileArn.split(":");
  if (parts[0] !== "arn" || parts[2] !== "codewhisperer" || !parts[3]) return null;
  try {
    return normalizeKiroRegion(parts[3]);
  } catch {
    return null;
  }
}

/**
 * Resolve the AWS region for a Kiro credential.
 * Priority: explicit providerSpecificData.region → profileArn region → default.
 */
export function resolveKiroRegion(credentials) {
  const psd = credentials?.providerSpecificData;
  return normalizeKiroRegion(psd?.region || regionFromProfileArn(psd?.profileArn) || KIRO_DEFAULT_REGION);
}

/**
 * Build the ordered GenerateAssistantResponse base URLs for a region,
 * automatically excluding hosts that do not exist in that region.
 */
export function buildKiroBaseUrls(region = KIRO_DEFAULT_REGION) {
  const r = normalizeKiroRegion(region || KIRO_DEFAULT_REGION);
  return KIRO_RUNTIME_HOSTS
    .filter((e) => hostAvailable(e, r))
    .map((e) => `https://${e.host(r)}${GENERATE_PATH}`);
}

/**
 * Return the amazonaws.com control-plane BASE URL (bare host, no path) for a
 * region's CodeWhisperer service.
 */
export function buildKiroProfileEndpoint(region = KIRO_DEFAULT_REGION) {
  const r = normalizeKiroRegion(region || KIRO_DEFAULT_REGION);
  const amazonHost = KIRO_RUNTIME_HOSTS
    .filter((e) => hostAvailable(e, r) && e.host(r).includes("amazonaws.com"))
    .map((e) => e.host(r))
    .find(Boolean);
  return `https://${amazonHost}`;
}

/** Region-scoped AWS SSO-OIDC token endpoint (IDC refresh). */
export function buildKiroOidcEndpoint(region = KIRO_DEFAULT_REGION) {
  const r = normalizeKiroRegion(region || KIRO_DEFAULT_REGION);
  return `https://oidc.${r}.amazonaws.com/token`;
}

/** Force a profileArn's region segment to match `region`. */
export function alignProfileArnRegion(profileArn, region) {
  if (!profileArn || !region) return profileArn || "";
  const r = normalizeKiroRegion(region);
  return profileArn.replace(/^(arn:aws:codewhisperer:)[^:]+(:)/, `$1${r}$2`);
}

/** Instruction appended to the retried Kiro turn after wrapper validation fails. */
export const KIRO_TOOL_CALL_REPAIR_INSTRUCTION = [
  "Retry the previous response because its Kiro tool_call wrapper was malformed.",
  "The tool_call input must be an object with a non-empty string name and an arguments field.",
  "Do not emit a tool_call wrapper without input.name and input.arguments.",
].join(" ");

export const KIRO_MAX_TOOL_CALL_REPAIR_ATTEMPTS = 1;
export const KIRO_MAX_TOOL_CALL_WRAPPER_BYTES = 256 * 1024;
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
  if (!value || !isObject(value)) return value;

  const cleaned = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === "properties" || key === "patternProperties") &&
      child && isObject(child) && !Array.isArray(child)) {
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
 */
export function normalizeKiroToolSchema(schema) {
  const source = schema && isObject(schema) ? structuredClone(schema) : {};
  const rootBranches = ["allOf", "oneOf", "anyOf"].map((keyword) => [
    keyword,
    Array.isArray(source[keyword]) ? source[keyword] : [],
  ]);
  for (const [keyword] of rootBranches) delete source[keyword];

  const cleaned = cleanKiroSchemaValue(source);
  cleaned.type = "object";
  if (!cleaned.properties || !isObject(cleaned.properties) || Array.isArray(cleaned.properties)) {
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
    (name) => isString(name) && Object.hasOwn(cleaned.properties, name)
  );
  return cleaned;
}

export const KIRO_DEFAULT_PROFILE_ARNS = {
  "builder-id": "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX",
  social: "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
};

export const KIRO_DEFAULT_PROFILE_ARN = KIRO_DEFAULT_PROFILE_ARNS["builder-id"];

/** Resolve the shared default profileArn for a given auth method. */
export function resolveDefaultProfileArn(authMethod) {
  const social = authMethod === "google" || authMethod === "github";
  return social ? KIRO_DEFAULT_PROFILE_ARNS.social : KIRO_DEFAULT_PROFILE_ARNS["builder-id"];
}

export const KIRO_THINKING_BUDGET_DEFAULT = 16000;

export const KIRO_UNSUPPORTED_THINKING_FIELDS = Object.freeze([
  "thinking", "reasoning", "reasoning_effort", "thinkingConfig",
  "enable_thinking", "thinking_budget", "output_config", "think",
]);

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

export function isAgenticModel(model) {
  return isString(model) && model.endsWith(KIRO_AGENTIC_SUFFIX);
}

export function stripAgenticSuffix(model) {
  if (!isAgenticModel(model)) return model;
  return model.slice(0, -KIRO_AGENTIC_SUFFIX.length);
}

export function isThinkingModel(model) {
  return isString(model) && model.endsWith(KIRO_THINKING_SUFFIX);
}

export function stripThinkingSuffix(model) {
  if (!isThinkingModel(model)) return model;
  return model.slice(0, -KIRO_THINKING_SUFFIX.length);
}

const ANTHROPIC_SNAPSHOT_SUFFIX = /-\d{8}$/;
const CLAUDE_VERSIONED = /^claude-(sonnet|opus|haiku)-(\d+)(?:[.-](\d+))?$/;
const CLAUDE_FAMILY_DOT = /([a-z])\.(\d)/gi;

export function normalizeKiroUpstreamModelId(model) {
  if (!isString(model) || model === "") return model;

  const spelled = /^claude/i.test(model) ? model.replace(CLAUDE_FAMILY_DOT, "$1-$2") : model;
  const id = spelled.toLowerCase().replace(ANTHROPIC_SNAPSHOT_SUFFIX, "");

  const m = id.match(CLAUDE_VERSIONED);
  if (m) return `claude-${m[1]}-${m[3] ? `${m[2]}.${m[3]}` : m[2]}`;
  if (id === "claude-fable-5") return "claude-fable-5";
  if (id === "minimax-m2.5" || id === "minimax-m2.1") return id;
  return spelled;
}

export function resolveKiroModel(model) {
  if (/\[1m\]/i.test(model)) {
    throw new Error("Kiro does not support the [1m] context suffix; use a direct Anthropic provider");
  }
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
  return { upstream: normalizeKiroUpstreamModelId(upstream), agentic, thinking };
}

export function buildThinkingSystemPrefix(budget = KIRO_THINKING_BUDGET_DEFAULT) {
  const safeBudget = Math.max(1, Math.min(32000, Number(budget) || KIRO_THINKING_BUDGET_DEFAULT));
  return `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>${safeBudget}</max_thinking_length>`;
}

export function pickKiroHeader(headers, name) {
  if (!headers) return undefined;
  if (isFunction(headers.get)) {
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

export function containsKiroThinkingModeTag(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role !== "system" && msg.role !== "user") continue;
    const content = msg.content;
    if (isString(content)) {
      if (containsKiroTagInText(content)) return true;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const text = part?.text;
        if (isString(text) && containsKiroTagInText(text)) return true;
      }
    }
  }
  if (isString(body?.system) && containsKiroTagInText(body.system)) return true;
  return false;
}

function containsKiroTagInText(text) {
  if (!text) return false;
  if (!text.includes("<thinking_mode>")) return false;
  return text.includes("<thinking_mode>enabled</thinking_mode>") ||
    text.includes("<thinking_mode>interleaved</thinking_mode>");
}

export default {
  id: "kiro",
  priority: 10,
  alias: "kr",
  uiAlias: "kr",
  display: {
    name: "Kiro AI",
    icon: "psychology_alt",
    color: "#FF6B35",
    website: "https://kiro.dev",
    notice: {
      signupUrl: "https://kiro.dev",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "free",
  transport: {
    baseUrl: "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
    baseUrls: [
      "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse",
      "https://q.us-east-1.amazonaws.com/generateAssistantResponse",
    ],
    format: "kiro",
    retry: {
      "429": 0,
    },
    headers: {
      "Content-Type": "application/json",
      Accept: "application/vnd.amazon.eventstream",
      "X-Amz-Target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
    },
    tokenUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
    authUrl: "https://prod.us-east-1.auth.desktop.kiro.dev",
    usage: {
      cwHost: "https://codewhisperer.us-east-1.amazonaws.com",
      qHost: "https://q.us-east-1.amazonaws.com",
      limitsPath: "/getUsageLimits",
    },
  },
  models: [
    // Opus (added per kiro.dev/changelog/models and kiro.dev/docs/models)
    ...buildKiroModelVariants("claude-opus-5", "Claude Opus 5"),
    { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "claude-opus-4.8-thinking", name: "Claude Opus 4.8 (Thinking)" },
    { id: "claude-opus-4.8-agentic", name: "Claude Opus 4.8 (Agentic)" },
    { id: "claude-opus-4.8-thinking-agentic", name: "Claude Opus 4.8 (Thinking + Agentic)" },
    { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "claude-opus-4.7-thinking", name: "Claude Opus 4.7 (Thinking)" },
    { id: "claude-opus-4.7-agentic", name: "Claude Opus 4.7 (Agentic)" },
    { id: "claude-opus-4.7-thinking-agentic", name: "Claude Opus 4.7 (Thinking + Agentic)" },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-opus-4.5-thinking", name: "Claude Opus 4.5 (Thinking)" },
    { id: "claude-opus-4.5-agentic", name: "Claude Opus 4.5 (Agentic)" },
    { id: "claude-opus-4.5-thinking-agentic", name: "Claude Opus 4.5 (Thinking + Agentic)" },
    // Sonnet
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    // Haiku
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    // Non-Anthropic
    { id: "deepseek-3.2", name: "DeepSeek 3.2", strip: ["image","audio"] },
    { id: "simple-task", name: "Simple Task", strip: ["image","audio"] },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next", strip: ["image","audio"] },
    { id: "glm-5", name: "GLM 5", strip: ["image","audio"] },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5", strip: ["image","audio"] },
    { id: "minimax-m2.1", name: "MiniMax M2.1", strip: ["image","audio"] },
    // Thinking variants
    { id: "claude-sonnet-5-thinking", name: "Claude Sonnet 5 (Thinking)" },
    { id: "claude-sonnet-4.5-thinking", name: "Claude Sonnet 4.5 (Thinking)" },
    { id: "claude-haiku-4.5-thinking", name: "Claude Haiku 4.5 (Thinking)" },
    // Agentic variants
    { id: "claude-sonnet-5-agentic", name: "Claude Sonnet 5 (Agentic)" },
    { id: "claude-sonnet-4.5-agentic", name: "Claude Sonnet 4.5 (Agentic)" },
    { id: "claude-haiku-4.5-agentic", name: "Claude Haiku 4.5 (Agentic)" },
    // Thinking + Agentic variants
    { id: "claude-sonnet-5-thinking-agentic", name: "Claude Sonnet 5 (Thinking + Agentic)" },
    { id: "claude-sonnet-4.5-thinking-agentic", name: "Claude Sonnet 4.5 (Thinking + Agentic)" },
    { id: "claude-haiku-4.5-thinking-agentic", name: "Claude Haiku 4.5 (Thinking + Agentic)" },
    { id: "claude-fable-5", name: "Claude Fable 5" },
    // GPT-5.6 family (decolua/9router#2596) — generated from the shared
    // leaf descriptor so the catalog, live fetcher, and capabilities agree.
    ...KIRO_GPT_5_6_FAMILY.flatMap(buildKiroGpt56Variants),
  ],
  oauth: {
    ssoOidcEndpoint: "https://oidc.us-east-1.amazonaws.com",
    registerClientUrl: "https://oidc.us-east-1.amazonaws.com/client/register",
    deviceAuthUrl: "https://oidc.us-east-1.amazonaws.com/device_authorization",
    tokenUrl: "https://oidc.us-east-1.amazonaws.com/token",
    startUrl: "https://view.awsapps.com/start",
    clientName: "kiro-oauth-client",
    clientType: "public",
    scopes: [
      "codewhisperer:completions",
      "codewhisperer:analysis",
      "codewhisperer:conversations",
    ],
    grantTypes: [
      "urn:ietf:params:oauth:grant-type:device_code",
      "refresh_token",
    ],
    issuerUrl: "https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6",
    socialAuthEndpoint: "https://prod.us-east-1.auth.desktop.kiro.dev",
    socialLoginUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/login",
    socialTokenUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token",
    socialRefreshUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
    authMethods: [
      "builder-id",
      "idc",
      "google",
      "github",
      "import",
    ],
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
