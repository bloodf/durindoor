/**
 * Microsoft 365 Copilot Web connection helpers.
 *
 * The BizChat access_token is carried in the Chathub WebSocket query string by
 * Microsoft's browser client, so logged URLs must pass through redactWsUrl().
 */
import { randomBytes, randomUUID } from "node:crypto";
import { isBoolean, isString } from "../../src/shared/utils/typeChecks.js";
import { isExpiredSessionToken } from "../utils/webSessionExpiry.js";
import { m365IdentityFromAccessToken } from "../utils/m365Identity.js";
import { m365ImagePartRef } from "./copilot-m365-images.js";
import { M365ExecutorError } from "./copilot-m365-output.js";

export const M365_EXPIRED_MESSAGE =
"Microsoft 365 Copilot access_token has expired. Copy a fresh Chathub WebSocket URL from a signed-in m365.cloud.microsoft/chat session.";

export const M365_INDIVIDUAL_DEFAULTS = {
  host: "substrate.office.com",
  source: "officeweb",
  product: "Office",
  agentHost: "Bizchat.FullScreen",
  licenseType: "Starter",
  agent: "web",
  scenario: "OfficeWebPaidConsumerCopilot"
};

export const M365_ALLOWED_HOSTS = new Set([M365_INDIVIDUAL_DEFAULTS.host]);
const M365_CHATHUB_PATH_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/;

export const M365_EDU_OVERRIDES = {
  scenario: "OfficeWebIncludedCopilot",
  isEdu: "true",
  licenseType: "Starter"
};

// OmniRoute #6334: work tenants opt in without changing consumer defaults.
export const M365_ENTERPRISE_OVERRIDES = {
  scenario: "officeweb",
  licenseType: "Premium",
  agent: "work"
};

export const M365_DEFAULT_VARIANTS = [
"EnableMcpServerWidgets",
"feature.EnableMcpServerWidgets",
"feature.EnableLuForChatCIQ",
"feature.enableChatCIQPlugin",
"EnableRequestPlugins",
"feature.EnableSensitivityLabels",
"EnableUnsupportedUrlDetector",
"feature.IsCustomEngineCopilotEnabled",
"feature.bizchatfluxv3",
"feature.enablechatpages",
"feature.enableCodeCanvas",
"feature.turnOnDARecommendation",
"feature.IsStreamingModeInChatRequestEnabled",
"IncludeSourceAttributionsConcise",
"SkipPublishEmptyMessage",
"feature.EnableDeduplicatingSourceAttributions",
"Enable3PActionProgressMessages",
"feature.enableClientWebRtc",
"feature.EnableMeetingRecapOfSeriesMeetingWithCiq",
"feature.cwcfluxv3fe",
"feature.cwcfluxv3fem",
"feature.EnableReferencesListCompleteSignal",
"feature.StorageMessageSplitDisabled",
"feature.EnableCuaTakeControlApi",
"SingletonEnvOn",
"EnableComposeWidget",
"feature.cwcallowedos",
"feature.EnableMergingPureDeltas",
"feature.disabledisallowedmsgs",
"feature.enableCitationsForSynthesisData",
"feature.EnableConversationShareApis",
"feature.enableGenerateGraphicArtOptionsSet",
"cdximagen",
"feature.EnableUpdatedUXForConfirmationDialog",
"feature.EnableContentApiandDocTypeHtmlInRichAnswers",
"cdxgrounding_api_v2_rich_web_answers_reference_bottom_force",
"cdxenablerenderforisocomp",
"feature.EnableClientFileURLSupportForOfficeWebPaidCopilot",
"feature.EnableDesignEditorImageGrounding",
"feature.EnableDesignerEditor",
"feature.EnableSkipRehydrationForSpeCIdImages",
"feature.EnablePersonalizationForMSA",
"agt_bizchat_enableRichResponses",
"feature.EnableBase64DataInMessageAnnotations",
"feature.EnableSkipEmittingMessageOnFlush",
"feature.EnableRemoveEmptySourceAttributions",
"feature.EnableRemoveStreamingMode"];


export function newChatSessionId() {
  return randomBytes(16).toString("hex");
}

export function isRedactedToken(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "redacted" || normalized === "<redacted>" || normalized === "[redacted]" || normalized === "***";
}

function hasEmptyOrRedactedAccessToken(value) {
  const match = String(value || "").match(/(^|[?&;\s])access_token=([^;&\s]*)/);
  return match && (!match[2] || isRedactedToken(match[2]));
}

const M365_CHATHUB_URL_PATH = "/m365Copilot/Chathub/";

/**
 * Pull the Chathub credential out of a DevTools HAR export. Only `wss://` entries on the exact
 * allowed host with the Chathub path count; foreign hosts, ports, userinfo and redacted tokens
 * are ignored, and the last (newest) matching entry wins. Ported in spirit from OmniRoute
 * open-sse/utils/m365Credentials.ts (inspectM365ChatHubUrl) at 07a790f5c158, narrowed to
 * DurinDoor's single-host allow-list.
 */
function parseHarCredential(value) {
  let data;
  try {
    data = JSON.parse(value);
  } catch {
    return null;
  }
  const entries = data?.log?.entries;
  if (!Array.isArray(entries)) return null;
  let found = {};
  for (const entry of entries) {
    const raw = entry?.request?.url;
    if (!isString(raw)) continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== "wss:" || !M365_ALLOWED_HOSTS.has(url.hostname) || url.port || url.username || url.password ||
      !url.pathname.startsWith(M365_CHATHUB_URL_PATH)) continue;
      const accessToken = url.searchParams.get("access_token") || "";
      const chathubPath = decodeURIComponent(url.pathname.slice(M365_CHATHUB_URL_PATH.length));
      if (!accessToken || isRedactedToken(accessToken) || !M365_CHATHUB_PATH_RE.test(chathubPath)) continue;
      found = { accessToken, chathubPath };
    } catch {
      continue;
    }
  }
  return found;
}

/** A HAR or JSON document is never itself an access token. */
function isStructuredJsonCredential(value) {
  return /^\s*[{[]/.test(String(value || ""));
}

function parsePastedCredential(raw) {
  const value = String(raw || "").trim();
  if (isStructuredJsonCredential(value)) return parseHarCredential(value) || {};
  const parts = {};

  for (const segment of value.split(/[;\n]/)) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const key = segment.slice(0, separator).trim();
    const partValue = segment.slice(separator + 1).trim();
    if (key && partValue && !isRedactedToken(partValue)) parts[key] = partValue;
  }

  if (/^wss:\/\/substrate\.office\.com\/m365Copilot\/Chathub\//i.test(value)) {
    try {
      const url = new URL(value);
      const token = url.searchParams.get("access_token") || "";
      if (!isRedactedToken(token)) parts.access_token ||= token;
      parts.chathubPath ||= decodeURIComponent(
        url.pathname.split("/m365Copilot/Chathub/")[1] || ""
      );
    } catch {

      // Keep any key/value fields already parsed from the pasted text.
    }}

  return {
    accessToken: parts.access_token || parts.accessToken,
    chathubPath: parts.chathubPath || parts.userTenant
  };
}

export function isStructuredPathOnlyCredential(value) {
  return /^(?:chathubPath|userTenant)\s*=/i.test(String(value || "").trim());
}

export function isStructuredWsUrlCredential(value) {
  return /^wss:\/\/substrate\.office\.com\/m365Copilot\/Chathub\//i.test(String(value || "").trim());
}

/**
 * The tier a connection routes through: `edu`, `enterprise` or undefined (individual). An explicit
 * `providerSpecificData.tier` wins (`individual`/`personal` opts out of the automatic choice). Without
 * one, and without explicit scenario/licence/agent fields, a native sign-in is a work or school
 * account (the consumer tenant is refused at sign-in), so it routes as `enterprise`. A pasted session
 * keeps the individual defaults: its token may be the opaque individual-tier kind.
 */
export function resolveM365Tier(credentials) {
  const psd = credentials?.providerSpecificData ?? {};
  const tier = isString(psd.tier) ? psd.tier.trim().toLowerCase() : "";
  if (tier === "edu" || tier === "included") return { tier: "edu", tierSource: "explicit" };
  if (tier === "enterprise" || tier === "work") return { tier: "enterprise", tierSource: "explicit" };
  if (tier) return { tier: undefined, tierSource: "explicit" };
  const explicitRoute = ["scenario", "licenseType", "agent", "isEdu"].some((key) => psd[key] !== undefined && psd[key] !== "");
  const nativeIdentity = isString(credentials?.accessToken) && m365IdentityFromAccessToken(credentials.accessToken);
  if (!explicitRoute && nativeIdentity) return { tier: "enterprise", tierSource: "auto" };
  return { tier: undefined, tierSource: "default" };
}

function resolveTierOverrides(psd, tier) {
  const isEduTier = tier === "edu";
  const isEnterpriseTier = tier === "enterprise";
  const psdIsEdu =
  isString(psd.isEdu) && psd.isEdu ||
  isBoolean(psd.isEdu) && String(psd.isEdu) ||
  undefined;
  return {
    scenario:
    isString(psd.scenario) && psd.scenario || (
    isEduTier ? M365_EDU_OVERRIDES.scenario : isEnterpriseTier ? M365_ENTERPRISE_OVERRIDES.scenario : undefined),
    isEdu: psdIsEdu || (isEduTier ? M365_EDU_OVERRIDES.isEdu : undefined),
    licenseType:
    isString(psd.licenseType) && psd.licenseType || (
    isEduTier ? M365_EDU_OVERRIDES.licenseType : isEnterpriseTier ? M365_ENTERPRISE_OVERRIDES.licenseType : undefined),
    agent: isString(psd.agent) && psd.agent || (isEnterpriseTier ? M365_ENTERPRISE_OVERRIDES.agent : undefined)
  };
}

export function resolveConnectionParams(credentials) {
  const psd = credentials?.providerSpecificData ?? {};
  const parsedApiKey = isString(credentials?.apiKey) ?
  parsePastedCredential(credentials.apiKey) :
  {};
  // A native sign-in row keeps its token in the canonical column (refreshed in place); a pasted
  // session keeps it in the credential text.
  const accessToken =
  isString(credentials?.accessToken) && credentials.accessToken ||
  parsedApiKey.accessToken ||
  isString(credentials?.apiKey) &&
  credentials.apiKey &&
  !isStructuredWsUrlCredential(credentials.apiKey) &&
  !isStructuredPathOnlyCredential(credentials.apiKey) &&
  !isStructuredJsonCredential(credentials.apiKey) &&
  !hasEmptyOrRedactedAccessToken(credentials.apiKey) &&
  credentials.apiKey ||
  isString(psd.accessToken) && psd.accessToken ||
  isString(psd.access_token) && psd.access_token ||
  "";
  if (!accessToken) {
    return { error: "Missing M365 Copilot access_token. Paste it as the provider credential." };
  }
  if (isExpiredSessionToken(accessToken)) {
    return { error: M365_EXPIRED_MESSAGE, expired: true };
  }

  const chathubPath =
  parsedApiKey.chathubPath ||
  isString(psd.chathubPath) && psd.chathubPath ||
  isString(psd.userTenant) && psd.userTenant ||
  isString(credentials?.accessToken) && m365IdentityFromAccessToken(credentials.accessToken)?.chathubPath ||
  "";
  if (!chathubPath || !M365_CHATHUB_PATH_RE.test(chathubPath)) {
    return {
      error:
      "Invalid M365 Chathub path. Paste only the '<user-oid>@<tenant-id>' segment from the WebSocket URL."
    };
  }

  const host = (isString(psd.host) && psd.host || M365_INDIVIDUAL_DEFAULTS.host).
  trim().
  toLowerCase();
  if (!M365_ALLOWED_HOSTS.has(host)) {
    return { error: "Unsupported M365 Copilot WebSocket host." };
  }
  const variants = isString(psd.variants) && psd.variants ? psd.variants : undefined;
  const { tier, tierSource } = resolveM365Tier(credentials);
  return { host, chathubPath, accessToken, variants, tier, tierSource, ...resolveTierOverrides(psd, tier) };
}

/**
 * Build the Chathub WebSocket URL. `params.disableMemory` marks the turn as a temporary chat. Pass `conversation` (`{ conversationId, sessionId }`) to continue an
 * existing conversation; otherwise new ids are minted. The access_token rides in the query string, so
 * the URL must only be logged through redactWsUrl().
 */
export function buildWsUrl(params, conversation) {
  const host = String(params?.host || "").trim().toLowerCase();
  if (!M365_ALLOWED_HOSTS.has(host)) throw new Error("Unsupported M365 Copilot WebSocket host");
  const chathubPath = String(params?.chathubPath || "");
  if (!M365_CHATHUB_PATH_RE.test(chathubPath)) throw new Error("Invalid M365 Chathub path");
  const [userId, tenantId] = chathubPath.split("@");
  const encodedPath = `${encodeURIComponent(userId)}@${encodeURIComponent(tenantId)}`;
  const sessionKey = newChatSessionId();
  const query = new URLSearchParams({
    chatsessionid: sessionKey,
    XRoutingParameterSessionKey: sessionKey,
    clientrequestid: sessionKey,
    "X-SessionId": conversation?.sessionId ?? randomUUID(),
    ConversationId: conversation?.conversationId ?? randomUUID(),
    access_token: params.accessToken,
    variants: params.variants ?? M365_DEFAULT_VARIANTS.join(","),
    source: M365_INDIVIDUAL_DEFAULTS.source,
    product: M365_INDIVIDUAL_DEFAULTS.product,
    agentHost: M365_INDIVIDUAL_DEFAULTS.agentHost,
    licenseType: params.licenseType ?? M365_INDIVIDUAL_DEFAULTS.licenseType,
    isEdu: params.isEdu ?? "false",
    agent: params.agent ?? M365_INDIVIDUAL_DEFAULTS.agent,
    scenario: params.scenario ?? M365_INDIVIDUAL_DEFAULTS.scenario
  });
  // Copilot's temporary chat: the conversation keeps its context while it runs and never
  // appears in the account's history or memory.
  if (params.disableMemory) query.set("disableMemory", "1");
  return `wss://${host}/m365Copilot/Chathub/${encodedPath}?${query.toString()}`;
}

export function redactWsUrl(wsUrl) {
  return String(wsUrl).replace(/access_token=[^&]*/i, "access_token=REDACTED");
}

/**
 * Format messages as turn text and collect the images they carry. An image part becomes a numbered
 * marker (`[image 1]`, ...) in the order its image is returned in `imageRefs`; the executor uploads
 * the images and attaches them to the message. Text parts pass through; any other part (audio, files)
 * is refused rather than silently dropped.
 */
export function promptFromMessages(messages) {
  const imageRefs = [];
  const partText = (part) => {
    if (isString(part)) return part;
    const imageRef = m365ImagePartRef(part);
    if (imageRef !== null) {
      imageRefs.push(imageRef);
      return `[image ${imageRefs.length}]`;
    }
    if (part?.type === "text" && isString(part.text)) return part.text;
    throw new M365ExecutorError(400, "unsupported_content", "Microsoft 365 Copilot accepts text and image parts only.");
  };
  const textOf = (content) => {
    if (isString(content)) return content;
    if (Array.isArray(content)) return content.map(partText).filter(Boolean).join("\n");
    return content == null ? "" : JSON.stringify(content);
  };
  const list = Array.isArray(messages) ? messages : [];
  const sysText = list.
  filter((m) => m.role === "system" || m.role === "developer").
  map((m) => textOf(m.content)).
  filter(Boolean).
  join("\n");
  const turns = list.
  filter((m) => m.role !== "system" && m.role !== "developer").
  map((m) => {
    const text = textOf(m.content).trim();
    const toolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length ? JSON.stringify(m.tool_calls) : "";
    if (!text && !toolCalls) return "";
    const role = m.role === "assistant" ? "Assistant" : m.role === "tool" ? "Tool" : "User";
    const header = role === "Tool" && m.tool_call_id ? `[Tool result id=${m.tool_call_id}]` : `[${role}]`;
    return [text && `${header}\n${text}`, toolCalls && `[Assistant tool_calls]\n${toolCalls}`].filter(Boolean).join("\n");
  }).
  filter(Boolean).
  join("\n\n");
  return { text: `${sysText ? `[System Instructions]\n${sysText}\n\n` : ""}${turns}`, imageRefs };
}

export function buildPrompt(body) {
  return promptFromMessages(body?.messages).text;
}
