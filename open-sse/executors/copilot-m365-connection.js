/**
 * Microsoft 365 Copilot Web connection helpers.
 *
 * The BizChat access_token is carried in the Chathub WebSocket query string by
 * Microsoft's browser client, so logged URLs must pass through redactWsUrl().
 */
import { randomBytes, randomUUID } from "node:crypto";
import { isBoolean, isString } from "@/shared/utils/typeChecks.js";

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

function parsePastedCredential(raw) {
  const value = String(raw || "").trim();
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

function resolveTierOverrides(psd) {
  const tier = isString(psd.tier) ? psd.tier.toLowerCase() : "";
  const isEduTier = tier === "edu" || tier === "included";
  const psdIsEdu =
  isString(psd.isEdu) && psd.isEdu ||
  isBoolean(psd.isEdu) && String(psd.isEdu) ||
  undefined;
  return {
    scenario:
    isString(psd.scenario) && psd.scenario || (
    isEduTier ? M365_EDU_OVERRIDES.scenario : undefined),
    isEdu: psdIsEdu || (isEduTier ? M365_EDU_OVERRIDES.isEdu : undefined),
    licenseType:
    isString(psd.licenseType) && psd.licenseType || (
    isEduTier ? M365_EDU_OVERRIDES.licenseType : undefined)
  };
}

export function resolveConnectionParams(credentials) {
  const psd = credentials?.providerSpecificData ?? {};
  const parsedApiKey = isString(credentials?.apiKey) ?
  parsePastedCredential(credentials.apiKey) :
  {};
  const accessToken =
  parsedApiKey.accessToken ||
  isString(credentials?.apiKey) &&
  credentials.apiKey &&
  !isStructuredWsUrlCredential(credentials.apiKey) &&
  !isStructuredPathOnlyCredential(credentials.apiKey) &&
  !hasEmptyOrRedactedAccessToken(credentials.apiKey) &&
  credentials.apiKey ||
  isString(psd.accessToken) && psd.accessToken ||
  isString(psd.access_token) && psd.access_token ||
  "";
  if (!accessToken) {
    return { error: "Missing M365 Copilot access_token. Paste it as the provider credential." };
  }

  const chathubPath =
  parsedApiKey.chathubPath ||
  isString(psd.chathubPath) && psd.chathubPath ||
  isString(psd.userTenant) && psd.userTenant ||
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
  return { host, chathubPath, accessToken, variants, ...resolveTierOverrides(psd) };
}

export function buildWsUrl(params) {
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
    "X-SessionId": randomUUID(),
    ConversationId: randomUUID(),
    access_token: params.accessToken,
    variants: params.variants ?? M365_DEFAULT_VARIANTS.join(","),
    source: M365_INDIVIDUAL_DEFAULTS.source,
    product: M365_INDIVIDUAL_DEFAULTS.product,
    agentHost: M365_INDIVIDUAL_DEFAULTS.agentHost,
    licenseType: params.licenseType ?? M365_INDIVIDUAL_DEFAULTS.licenseType,
    isEdu: params.isEdu ?? "false",
    agent: M365_INDIVIDUAL_DEFAULTS.agent,
    scenario: params.scenario ?? M365_INDIVIDUAL_DEFAULTS.scenario
  });
  return `wss://${host}/m365Copilot/Chathub/${encodedPath}?${query.toString()}`;
}

export function redactWsUrl(wsUrl) {
  return String(wsUrl).replace(/access_token=[^&]*/i, "access_token=REDACTED");
}

export function buildPrompt(body) {
  const messages = body?.messages || [];
  const textOf = (content) => {
    if (isString(content)) return content;
    if (Array.isArray(content)) {
      return content.
      map((part) => {
        if (isString(part)) return part;
        if (part?.type === "text" && isString(part.text)) return part.text;
        return JSON.stringify(part ?? "");
      }).
      filter(Boolean).
      join("\n");
    }
    return content == null ? "" : JSON.stringify(content);
  };
  const sysText = messages.
  filter((m) => m.role === "system" || m.role === "developer").
  map((m) => textOf(m.content)).
  filter(Boolean).
  join("\n");
  const turns = messages.
  filter((m) => m.role !== "system" && m.role !== "developer").
  map((m) => {
    const text = textOf(m.content).trim();
    if (!text) return "";
    const role = m.role === "assistant" ? "Assistant" : m.role === "tool" ? "Tool" : "User";
    return `[${role}]\n${text}`;
  }).
  filter(Boolean).
  join("\n\n");
  return `${sysText ? `[System Instructions]\n${sysText}\n\n` : ""}${turns}`;
}