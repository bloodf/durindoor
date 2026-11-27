// fal.ai ACE-Step for /v1/music/generations: optional schema discovery, one
// queue submit, bounded polling, a hosted audio URL. Staged and NOT
// registered: musicGenerationCore.js, the provider registry and the catalog
// are unchanged until the serial registration change described in
// ./registration.json and internal/docs/port-reports/native-fal-ai-music.md.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/musicRegistry.ts (`fal-ai` -> format "fal-ai-music"),
// open-sse/handlers/musicGeneration.ts (dispatch of that format to
// handleFalMusicGeneration with the route's signal and prepareFalInput) and
// open-sse/handlers/mediaGeneration/fal.ts (handleFalMusicGeneration: the
// built-in ACE-Step body unless the request carries `fal_input`, in which case
// the input is prepared from the endpoint's discovered schema). The request
// builder is ./request.js, discovery ./discovery.js, the queue client ./job.js
// and the result ./result.js; their headers list the fork deviations.
//
// The adapter follows the music core result contract of
// handlers/musicGenerationCore.js (`{ success, response, accounting }` with
// `accounting.state` "complete"; error results from createErrorResult) plus
// `acceptedJob` on errors that may bill, as the video and image cores do.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { FAL_MUSIC_RESPONSE_FORMATS } from "./config.js";
import { buildFalMusicRequest, checkFalMusicEnvelope, falMusicCompatibilityInput } from "./request.js";
import { prepareFalMusicInput } from "./discovery.js";
import { FAL_MUSIC_REQUEST_TIMEOUT_MS, FAL_MUSIC_TIMEOUT_MS, falMusicAcceptedJob, falMusicToken, runFalMusicJob } from "./job.js";
import { normalizeFalMusicResult } from "./result.js";

export const FAL_MUSIC_DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * @param {object} [options] - job bounds, clock, waiter, and an optional
 *   connection-scoped definition store `{ get(connectionId, endpoint), save(connectionId, definition) }`
 */
export function createFalMusicAdapter({
  definitionStore = null,
  timeoutMs = FAL_MUSIC_TIMEOUT_MS,
  discoveryTimeoutMs = FAL_MUSIC_DISCOVERY_TIMEOUT_MS,
  wait = sleep,
  now = Date.now,
  ...job
} = {}) {
  return {
    async: false,
    responseFormats: FAL_MUSIC_RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Generate one track for the selected connection, synchronously.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }`, or
     * an error result that carries `acceptedJob` when the request may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      if (signal?.aborted) return createErrorResult(499, "fal music request aborted");
      let envelope;
      let request;
      try {
        envelope = checkFalMusicEnvelope(model, body);
        if (body.fal_input === undefined || body.fal_input === null) request = buildFalMusicRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = falMusicToken(credentials);
      if (!token) return createErrorResult(401, "Fal API key is required");
      const secrets = { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken };
      const deadline = now() + timeoutMs;

      if (!request) {
        // Discovery sends nothing billable; its failures carry no acceptedJob.
        const discoveryDeadline = now() + Math.min(discoveryTimeoutMs, timeoutMs);
        try {
          request = await prepareFalMusicInput({
            endpoint: envelope.endpoint,
            body,
            buildInput: falMusicCompatibilityInput,
            credentials,
            store: definitionStore,
            token,
            signal,
            proxyOptions: resolveCredentialProxyOptions(credentials),
            timeoutMs: () => Math.max(1, Math.min(FAL_MUSIC_REQUEST_TIMEOUT_MS, discoveryDeadline - now())),
            wait,
            now,
          });
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") return createErrorResult(499, "fal music request aborted");
          const status = Number(error?.status);
          return createErrorResult(Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
            error?.status ? error.message : "fal schema discovery failed", undefined, undefined, null, secrets);
        }
      }

      const result = await runFalMusicJob({ ...job, endpoint: envelope.endpoint, request, credentials, signal, log, deadline, wait, now });
      if (!result.success) return result;
      const normalized = normalizeFalMusicResult(result.output, { model: envelope.model, requestId: result.requestId, created: Math.floor(now() / 1000) });
      if (normalized.error) {
        // The request finished upstream, so it may bill even though nothing usable came back.
        return { ...createErrorResult(HTTP_STATUS.BAD_GATEWAY, normalized.error), acceptedJob: falMusicAcceptedJob("completed") };
      }
      // Usage counts the track returned. Duration and cost are unknown here.
      const accounting = {
        ...result.accounting,
        state: "complete",
        nativeUnits: { tracks: 1 },
        meta: { ...result.accounting.meta, nativeUnitsSource: "returned-tracks" },
      };
      return {
        success: true,
        accounting,
        response: new Response(JSON.stringify(normalized.payload), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    },
  };
}

export default createFalMusicAdapter();
