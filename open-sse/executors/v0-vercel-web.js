// Adapted from OmniRoute open-sse/executors/v0-vercel-web.ts, revision
// 9671192011beb2d7f83979f40be488c5da8772b9 (MIT).
import { WebSessionExecutor } from "./webSessionBase.js";
import { isRefusedRedirect } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { errorResponse } from "../utils/error.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

export const V0_CHAT_URL = "https://v0.dev/api/chat";
const ORIGIN = "https://v0.dev";

/** Accept only the named session cookie, never other account cookies. */
export function v0SessionCookie(credentials = {}) {
  const raw = credentials.apiKey;
  if (!isString(raw) || !raw.trim() || /[\r\n]/.test(raw)) return null;
  const input = raw.trim();
  if (!input.includes("=")) return /^[\x21-\x3a\x3c-\x7e]+$/.test(input) ? `__vercel_session=${input}` : null;
  const matches = input.split(";").map((part) => part.trim()).filter((part) => part.startsWith("__vercel_session="));
  if (matches.length !== 1 || !/^__vercel_session=[\x21-\x3a\x3c-\x7e]+$/.test(matches[0])) return null;
  return matches[0];
}

function failure(status, message, body) {
  const type = status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" : status < 500 ? "invalid_request_error" : "upstream_error";
  return { response: errorResponse(status, message, { type, code: status === 401 ? "invalid_session" : `HTTP_${status}` }), url: V0_CHAT_URL, headers: {}, transformedBody: body };
}
function statusFailure(status, body) {
  if ((status >= 300 && status < 400) || status === 401 || status === 403) return failure(401, "v0 session rejected or expired; re-enter the session cookie", body);
  return failure(status >= 400 && status < 500 ? status : 502, `v0 request failed (HTTP ${status})`, body);
}
function completion(model, message, usage) {
  const result = { id: `chatcmpl-v0-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message, finish_reason: "stop" }] };
  if (usage) result.usage = usage;
  return result;
}

export class V0VercelWebExecutor extends WebSessionExecutor {
  constructor() { super("v0-vercel-web", { id: "v0-vercel-web", baseUrl: V0_CHAT_URL }); }
  async runSession(input, transport) {
      const cookie = v0SessionCookie(input.credentials);
      if (!cookie) return failure(401, "v0 session cookie is missing or malformed", input.body);
      const body = input.body || {};
      const model = isString(body.model) && body.model ? body.model : input.model || "v0-default";
      const stream = input.stream === true;
      const request = { messages: (Array.isArray(body.messages) ? body.messages : []).map(({ role, content }) => ({ role, content })), model, stream };
      const headers = { "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json", Origin: ORIGIN, Referer: `${ORIGIN}/`, Cookie: cookie };
      try {
        const upstream = await transport.sendBillable(V0_CHAT_URL, { method: "POST", headers, body: JSON.stringify(request), redirect: "manual", signal: input.signal });
        if (!upstream.ok) return statusFailure(upstream.status, request);
        const result = { url: V0_CHAT_URL, headers: { Cookie: "[REDACTED]" }, transformedBody: request };
        if (stream) {
          if (!upstream.body || !(upstream.headers.get("content-type") || "").includes("text/event-stream")) return failure(502, "v0 returned an invalid stream", request);
          return { ...result, response: upstream };
        }
        const data = await upstream.json().catch(() => null);
        if (!isRecord(data)) return failure(502, "v0 returned invalid JSON", request);
        if (data.error) return statusFailure(Number(data.error.status || data.error.code) || 502, request);
        const source = data.choices?.[0]?.message || data;
        if (!isString(source.content) && !isString(source.reasoning_content)) return failure(502, "v0 returned an invalid completion", request);
        const message = { role: "assistant", content: source.content || "" };
        if (source.reasoning_content) message.reasoning_content = source.reasoning_content;
        return { ...result, response: Response.json(completion(model, message, data.usage)) };
      } catch (error) {
        if (error?.name === "AbortError" || isQuotaDispatchUnavailable(error)) throw error;
        if (isRefusedRedirect(error)) return statusFailure(302, request);
        return failure(502, "v0 request failed", request);
      }
  }
}
export default V0VercelWebExecutor;
