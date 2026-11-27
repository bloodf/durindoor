// Google Flow request/response transforms, ported as DORMANT reference code.
// The adapter never calls them: the source entry is disabled (see
// ./config.js), and its own handler does not call them either. They are kept,
// with tests, so a later change that finds a working transport starts from
// the exact source contract rather than a guess.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/videoGeneration/googleFlow.ts (normalizeFlowVideoParams,
// buildGoogleFlowSubmitBody, parseFlowOperationName, parseFlowOperationResult,
// resolveFlowProjectId, resolveFlowAccessToken, resolveVideoCredentialProvider).
// The source itself marks the wire envelope "PENDING LIVE VALIDATION": whether
// Flow wraps the Veo body in a Cloud Code `{ project, request }` envelope was
// never confirmed.
//
// Fork addition: googleFlowPublicArtifact, which a future transport must pass
// every parsed result through. It admits inline MP4 base64 or a public https
// URL only, so a `gs://` bucket URI, a URL with userinfo, or a non-https URL
// from upstream is never handed to a client.
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { GOOGLE_FLOW_CREDENTIAL_PROVIDER, GOOGLE_FLOW_VIDEO_PROVIDER_ID } from "./config.js";

/** Map a video provider id to the provider id whose stored credentials it uses (source contract). */
export function resolveVideoCredentialProvider(provider) {
  return provider === GOOGLE_FLOW_VIDEO_PROVIDER_ID ? GOOGLE_FLOW_CREDENTIAL_PROVIDER : provider;
}

function asTrimmedString(value) {
  if (!isString(value)) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const ASPECT_RATIO_RE = /^\d{1,2}:\d{1,2}$/;

/** Normalize an OpenAI-style /v1/videos/generations body into Veo parameters (source contract). */
export function normalizeFlowVideoParams(body) {
  const b = body ?? {};
  const prompt = isString(b.prompt) ? b.prompt : String(b.prompt ?? "");
  const sizeMaybeRatio = asTrimmedString(b.size);
  const aspectRatio =
    asTrimmedString(b.aspect_ratio) ??
    asTrimmedString(b.aspectRatio) ??
    (sizeMaybeRatio && ASPECT_RATIO_RE.test(sizeMaybeRatio) ? sizeMaybeRatio : undefined);
  const durationRaw =
    isNumber(b.duration) ? b.duration : isNumber(b.durationSeconds) ? b.durationSeconds : undefined;
  const durationSeconds =
    isNumber(durationRaw) && Number.isFinite(durationRaw) && durationRaw > 0 ? Math.floor(durationRaw) : undefined;
  const nRaw = isNumber(b.n) ? b.n : undefined;
  const sampleCount = isNumber(nRaw) && Number.isFinite(nRaw) && nRaw > 0 ? Math.floor(nRaw) : 1;
  return {
    prompt,
    aspectRatio,
    durationSeconds,
    sampleCount,
    negativePrompt: asTrimmedString(b.negative_prompt) ?? asTrimmedString(b.negativePrompt),
    resolution: asTrimmedString(b.resolution),
  };
}

/** The Veo `predictLongRunning`-shaped submit body (source contract). Only provided optionals are set. */
export function buildGoogleFlowSubmitBody(params) {
  const parameters = { sampleCount: params.sampleCount };
  if (params.aspectRatio) parameters.aspectRatio = params.aspectRatio;
  if (isNumber(params.durationSeconds)) parameters.durationSeconds = params.durationSeconds;
  if (params.negativePrompt) parameters.negativePrompt = params.negativePrompt;
  if (params.resolution) parameters.resolution = params.resolution;
  return { instances: [{ prompt: params.prompt }], parameters };
}

/** The operation name from `{ name }` or `{ operation: { name } }`, else null (source contract). */
export function parseFlowOperationName(json) {
  if (!isRecord(json)) return null;
  if (isString(json.name) && json.name.length > 0) return json.name;
  const op = json.operation;
  if (isRecord(op) && isString(op.name) && op.name.length > 0) return op.name;
  return null;
}

function extractVideoFromResponse(response) {
  if (!isRecord(response)) return null;
  const videos = response.videos;
  if (Array.isArray(videos) && videos.length > 0) {
    const v = videos[0];
    if (isRecord(v)) {
      if (isString(v.bytesBase64Encoded)) return { base64: v.bytesBase64Encoded };
      if (isString(v.gcsUri)) return { url: v.gcsUri };
      if (isString(v.uri)) return { url: v.uri };
    }
  }
  const gen = response.generateVideoResponse;
  const samples = isRecord(gen) ? gen.generatedSamples : undefined;
  if (Array.isArray(samples) && samples.length > 0) {
    const video = isRecord(samples[0]) ? samples[0].video : undefined;
    if (isRecord(video)) {
      if (isString(video.uri)) return { url: video.uri };
      if (isString(video.bytesBase64Encoded)) return { base64: video.bytesBase64Encoded };
    }
  }
  return null;
}

/** Interpret a poll response; `done: false` means still running (source contract). */
export function parseFlowOperationResult(json) {
  if (!isRecord(json)) return { done: false };
  if (!json.done) return { done: false };
  const opError = json.error;
  if (isRecord(opError)) {
    return { done: true, error: String(opError.message || "Google Flow video operation failed") };
  }
  const video = extractVideoFromResponse(json.response);
  if (video?.base64) return { done: true, base64: video.base64, format: "mp4" };
  if (video?.url) return { done: true, url: video.url, format: "mp4" };
  return { done: true, error: "Google Flow operation completed but returned no video" };
}

/** The Cloud Code projectId from the credential record (source contract). */
export function resolveFlowProjectId(credentials) {
  const cred = credentials ?? {};
  const direct = asTrimmedString(cred.projectId);
  if (direct) return direct;
  const psd = cred.providerSpecificData;
  if (isRecord(psd)) {
    const fromPsd = asTrimmedString(psd.projectId);
    if (fromPsd) return fromPsd;
  }
  return null;
}

/** The OAuth bearer from the credential record (source contract). */
export function resolveFlowAccessToken(credentials) {
  const cred = credentials ?? {};
  return asTrimmedString(cred.accessToken) ?? asTrimmedString(cred.apiKey) ?? null;
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Admit a parsed result for a client: `{ b64_json }` for well-formed base64,
 * `{ url }` for an https URL without userinfo, otherwise null. Fork hardening.
 */
export function googleFlowPublicArtifact(result) {
  if (!result || result.done !== true || result.error) return null;
  if (isString(result.base64)) {
    const b64 = result.base64.replace(/\s+/g, "");
    return b64.length > 0 && b64.length % 4 === 0 && BASE64_RE.test(b64) ? { b64_json: b64, format: "mp4" } : null;
  }
  if (isString(result.url)) {
    let url;
    try { url = new URL(result.url); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { url: url.href, format: "mp4" };
  }
  return null;
}
