import { isObject, isString } from "@/shared/utils/typeChecks.js";export const BEDROCK_DEFAULT_REGION = "us-east-1";

const BEDROCK_REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/i;

export function normalizeBedrockRegion(value, fallback = BEDROCK_DEFAULT_REGION) {
  if (!isString(value)) return fallback;
  const trimmed = value.trim().toLowerCase();
  return BEDROCK_REGION_PATTERN.test(trimmed) ? trimmed : fallback;
}

export function extractBedrockRegionFromBaseUrl(value) {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname;
    const match = hostname.match(/^bedrock(?:-runtime|-mantle)?\.([a-z0-9-]+)\./i);
    return match?.[1] ? normalizeBedrockRegion(match[1], "") || null : null;
  } catch {
    return null;
  }
}

export function resolveBedrockRegion(providerSpecificData) {
  const data =
  providerSpecificData && isObject(providerSpecificData) ? providerSpecificData : {};
  const explicit = normalizeBedrockRegion(data.region, "");
  if (explicit) return explicit;
  return extractBedrockRegionFromBaseUrl(data.baseUrl) || BEDROCK_DEFAULT_REGION;
}

export function buildBedrockRuntimeBaseUrl(region) {
  return `https://bedrock-runtime.${normalizeBedrockRegion(region)}.amazonaws.com`;
}

export function buildBedrockNativeConverseUrl(region, modelId, stream = false) {
  return `${buildBedrockRuntimeBaseUrl(region)}/model/${encodeURIComponent(modelId)}/${
  stream ? "converse-stream" : "converse"}`;

}