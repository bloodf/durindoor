// DashScope media region map for the staged native adapters (#2034): image
// (this directory), video (../native-dashscope-video) and speech
// (../native-dashscope-tts) resolve a connection's region here.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// src/shared/constants/alibabaProviderRegions.ts:
// - ALIBABA_PROVIDER_REGION_VALUES: "global-sg" and "china-beijing";
// - normalizeAlibabaProviderRegion: the spellings of each region;
// - getDefaultAlibabaProviderRegion: "global-sg" for these four identities;
// - ALIBABA_PROVIDER_ENDPOINTS + LEGACY_FAMILY_PRESETS: the chat presets a
//   saved connection may carry in providerSpecificData.baseUrl, which the
//   source treats as "no custom base URL" (isFamilyPresetUrl);
// - resolveAlibabaProviderMediaBaseUrl + ALIBABA_PROVIDER_MEDIA_OVERRIDES: the
//   media root of each identity and region (chat root with /compatible-mode/v1
//   or /apps/anthropic/v1 replaced by /api/v1; bailian-coding-plan media stays
//   on the coding DashScope hosts).
//
// Fork deviations, each an explicit refusal before anything is sent:
// - an unrecognized region value (the source silently falls back to
//   global-sg, which would send the key to a region the owner did not pick);
// - a custom, non-preset connection base URL (the source sends the key to it);
// - an identity outside the four below (alibaba-cn and the other Alibaba-family
//   ids are separate identities with their own keys and are not served here).
// The map is finite and literal: an origin is only ever looked up by
// (identity, region), never built from connection or caller input.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";

export const DASHSCOPE_REGIONS = Object.freeze(["global-sg", "china-beijing"]);
export const DASHSCOPE_DEFAULT_REGION = "global-sg";
export const DASHSCOPE_MEDIA_API_PATH = "/api/v1";

const freezeRegions = (globalSg, chinaBeijing) => Object.freeze({ "global-sg": globalSg, "china-beijing": chinaBeijing });

/** Media origins per identity and region (source media roots minus /api/v1). */
export const DASHSCOPE_MEDIA_ORIGINS = Object.freeze({
  alibaba: freezeRegions("https://dashscope-intl.aliyuncs.com", "https://dashscope.aliyuncs.com"),
  "qwen-cloud": freezeRegions("https://dashscope-intl.aliyuncs.com", "https://dashscope.aliyuncs.com"),
  "qwen-cloud-token-plan": freezeRegions(
    "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    "https://token-plan.cn-beijing.maas.aliyuncs.com",
  ),
  "bailian-coding-plan": freezeRegions("https://coding-intl.dashscope.aliyuncs.com", "https://coding.dashscope.aliyuncs.com"),
});

/** Source chat presets (current and retired) per identity; a saved preset is not a custom base URL. */
const CHAT_PRESETS = Object.freeze({
  alibaba: ["https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
  "qwen-cloud": ["https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
  "qwen-cloud-token-plan": [
    "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  ],
  "bailian-coding-plan": [
    "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/v1",
    "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic/v1",
    "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1",
    "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1",
  ],
});

const REGION_SPELLINGS = Object.freeze({
  "global-sg": "global-sg",
  global: "global-sg",
  international: "global-sg",
  singapore: "global-sg",
  "ap-southeast-1": "global-sg",
  "china-beijing": "china-beijing",
  china: "china-beijing",
  cn: "china-beijing",
  beijing: "china-beijing",
  "cn-beijing": "china-beijing",
});

const MAX_BASE_URL_LENGTH = 2048;

/** The canonical region for a source spelling, or null for anything else. */
export function normalizeDashscopeRegion(value) {
  if (!isString(value)) return null;
  const key = value.trim().toLowerCase();
  return Object.hasOwn(REGION_SPELLINGS, key) ? REGION_SPELLINGS[key] : null;
}

// Source normalizeEndpoint: trailing slashes and a chat suffix dropped, case folded.
function normalizePreset(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end).replace(/\/(?:chat\/completions|messages)$/i, "").toLowerCase();
}

/** Whether a saved connection base URL is one of the identity's source presets. */
export function isDashscopePresetBaseUrl(providerId, baseUrl) {
  if (!Object.hasOwn(CHAT_PRESETS, providerId) || !isString(baseUrl) || baseUrl.length > MAX_BASE_URL_LENGTH) return false;
  const wanted = normalizePreset(baseUrl.trim());
  return CHAT_PRESETS[providerId].some((preset) => normalizePreset(preset) === wanted);
}

/** The media origin of an identity in a canonical region, or null. */
export function dashscopeMediaOrigin(providerId, region) {
  if (!Object.hasOwn(DASHSCOPE_MEDIA_ORIGINS, providerId)) return null;
  const regions = DASHSCOPE_MEDIA_ORIGINS[providerId];
  return Object.hasOwn(regions, region) ? regions[region] : null;
}

/**
 * The region and media origin the selected connection is bound to.
 *
 * @param {string} providerId - the adapter's own identity; never read from the connection
 * @param {object} credentials - the selected connection (providerSpecificData.region / baseUrl)
 * @param {readonly string[]} [supported] - regions this identity serves for the modality
 * @returns {{ region: string, origin: string } | { error: string }}
 */
export function resolveDashscopeConnectionRegion(providerId, credentials, supported = DASHSCOPE_REGIONS) {
  if (!Object.hasOwn(DASHSCOPE_MEDIA_ORIGINS, providerId)) return { error: "is not a DashScope regional identity" };
  const data = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData : {};
  const raw = data.region;
  let region = DASHSCOPE_DEFAULT_REGION;
  if (raw !== undefined && raw !== null && !(isString(raw) && !raw.trim())) {
    region = normalizeDashscopeRegion(raw);
    if (!region) return { error: "names an unknown region; use global-sg or china-beijing" };
  }
  if (!supported.includes(region)) return { error: `is not served in region ${region}` };
  const baseUrl = data.baseUrl;
  if (baseUrl !== undefined && baseUrl !== null && !(isString(baseUrl) && !baseUrl.trim()) && !isDashscopePresetBaseUrl(providerId, baseUrl)) {
    return { error: "has a custom base URL, which is not supported; the key goes only to the region's fixed host" };
  }
  return { region, origin: dashscopeMediaOrigin(providerId, region) };
}
