import { CONTEXT_LENGTH_EXCEEDED_CODE } from "open-sse/config/errorConfig.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { buildResponsesFailureBytes } from "open-sse/utils/responsesStreamHelpers.js";

/**
 * Codex compacts and retries on a `response.failed` event carrying
 * context_length_exceeded, not on an HTTP 400. Call this only on the final
 * response: account and combo fallback still need the HTTP failure.
 *
 * @param {Response} response - final gateway response
 * @param {{ stream?: boolean, sourceFormat?: string }} request - client request shape
 * @returns {Promise<Response>} the SSE failure, or `response` unchanged
 */
export async function toResponsesContextFailure(response, { stream, sourceFormat }) {
  if (stream !== true || sourceFormat !== FORMATS.OPENAI_RESPONSES || response?.status !== HTTP_STATUS.BAD_REQUEST) {
    return response;
  }
  const error = await response.clone().json().then((body) => body?.error, () => null);
  if (error?.code !== CONTEXT_LENGTH_EXCEEDED_CODE) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/event-stream");
  headers.set("cache-control", "no-cache");
  return new Response(buildResponsesFailureBytes(error), { headers });
}
