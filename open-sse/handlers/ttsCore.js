import { Buffer } from "node:buffer";
import { createErrorResult, sanitizeErrorMessageWithSecrets } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getTtsAdapter, synthesizeViaConfig } from "./ttsProviders/index.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

// Re-export voice fetchers + voices APIs for backward compat with existing routes
export {
  VOICE_FETCHERS,
  fetchEdgeTtsVoices,
  fetchLocalDeviceVoices,
  fetchElevenLabsVoices,
} from "./ttsProviders/index.js";

// ── Response Formatter (DRY) ───────────────────────────────────
function createTtsResponse(base64Audio, format, responseFormat) {
  const audioBuffer = Buffer.from(base64Audio, "base64");

  // JSON format: return base64 encoded audio
  if (responseFormat === "json") {
    return {
      success: true,
      audioBuffered: true,
      response: new Response(JSON.stringify({ audio: base64Audio, format }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }),
    };
  }

  // Binary format (default): return raw audio
  return {
    success: true,
    audioBuffered: true,
    response: new Response(audioBuffer, {
      headers: {
        "Content-Type": `audio/${format}`,
        "Content-Length": String(audioBuffer.length),
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}

/** Attach native usage without reading, cloning, or buffering the audio response.
 * Count Unicode code points in the trimmed input sent to the adapter, not tokens.
 * Published character rates are estimates, not an authoritative provider charge:
 * https://developers.openai.com/api/docs/pricing (2026-10-09).
 * Adapter accounting contains only provider-reported tokens, units and receipts.
 * audioBuffered marks responses built from fully received audio, safe to bill now.
 * All other bodies defer accounting until clean EOF. When accountingCompletion
 * exists, only its "completed" outcome authorizes success accounting; it supplies
 * the final provider receipt. Cancellation and body errors never authorize usage.
 */
function withTtsUsage(result, provider, model, input, credentials) {
  if (!result.success) return result;
  let characters = 0;
  for (const character of input) characters++;
  const billedModel = model?.includes("/") ? model.split("/")[0] : PROVIDER_MEDIA.openai?.ttsConfig?.defaultModel;
  const officialOpenai = provider === "openai" &&
    (!credentials?.baseUrl || credentials.baseUrl.replace(/\/+$/, "") === "https://api.openai.com");
  const rate = officialOpenai ? (billedModel === "tts-1" ? 15 : billedModel === "tts-1-hd" ? 30 : undefined) : undefined;
  const merge = (accounting = {}) => ({
    tokens: {},
    cost: rate === undefined ? null : characters * rate / 1_000_000,
    costStatus: rate === undefined ? "unknown" : "estimated",
    costSource: rate === undefined ? "unavailable" : "https://developers.openai.com/api/docs/pricing#tts",
    ...accounting,
    nativeUnits: { characters, ...accounting.nativeUnits },
  });
  return {
    ...result,
    accounting: merge(result.accounting),
    ...(result.accountingCompletion && {
      accountingCompletion: result.accountingCompletion.then((outcome) => ({ ...outcome, accounting: merge(outcome.accounting) })),
    }),
  };
}

// ── Core handler ───────────────────────────────────────────────
/**
 * Synthesize text to audio. Provider logic lives in `./ttsProviders/{id}.js`
 * or is dispatched generically via `ttsConfig.format`.
 *
 * Successful results include accounting metadata; binary response bodies stay unread.
 * @returns {Promise<{success, response, accounting?, accountingCompletion?, status?, error?}>}
 */
export async function handleTtsCore({ provider, model, input, credentials, responseFormat = "mp3", language, ...options }) {
  if (input == null || !isString(input) || !input.trim()) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }

  try {
    // Special-case adapters (google-tts, edge-tts, local-device, elevenlabs, openai, openrouter, gemini)
    const adapter = getTtsAdapter(provider);
    if (adapter) {
      const result = await adapter.synthesize(input.trim(), model, credentials, responseFormat, { ...options, language, proxyOptions: resolveCredentialProxyOptions(credentials) });
      // Adapter may return a full {success, response} (legacy) or {base64, format}
      return withTtsUsage(result.success !== undefined ? result : { ...createTtsResponse(result.base64, result.format, responseFormat), accounting: result.accounting, accountingCompletion: result.accountingCompletion }, provider, model, input.trim(), credentials);
    }

    // Generic provider requests inherit the connection's immutable egress policy.
    const proxyOptions = resolveCredentialProxyOptions(credentials);
    const result = await synthesizeViaConfig(provider, input.trim(), model, credentials, proxyOptions, { ...options, language, responseFormat });
    if (result) return withTtsUsage(result.success !== undefined ? result : { ...createTtsResponse(result.base64, result.format, responseFormat), accounting: result.accounting, accountingCompletion: result.accountingCompletion }, provider, model, input.trim(), credentials);

    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support TTS via this route.`);
  } catch (err) {
    const secrets = [credentials?.apiKey, credentials?.accessToken, credentials?.refreshToken];
    return createErrorResult(
      HTTP_STATUS.BAD_GATEWAY,
      sanitizeErrorMessageWithSecrets(err?.message || "TTS synthesis failed", secrets),
    );
  }
}
