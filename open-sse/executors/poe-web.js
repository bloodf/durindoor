// Ported from OmniRoute 9671192011beb2d7f83979f40be488c5da8772b9,
// open-sse/executors/poe-web.ts (MIT). The upstream response is JSON.
import { WebSessionExecutor } from './web-session-executor.js';
import { isRefusedRedirect } from './sendRequest.js';
import { isQuotaDispatchUnavailable } from '../services/quota/dispatch.js';
import { errorResponse } from '../utils/error.js';
import { isString } from '../../src/shared/utils/typeChecks.js';
import { POE_WEB_MODELS } from '../providers/registry/poe-web.js';

export const POE_WEB_URL = 'https://www.poe.com/api/gql_POST';
const ORIGIN = 'https://www.poe.com';
const QUERY = `query ChatViewQuery($bot: String!, $query: String!) {
        chatWithBot(bot: $bot, query: $query) {
          messageId
          text
          state
        }
      }`;

/** Accept a bare p-b value or a cookie header containing exactly one p-b. */
export function parsePoeCookie(raw) {
  if (!isString(raw) || /[\r\n]/.test(raw)) return null;
  const value = raw.trim().replace(/^cookie:\s*/i, '');
  if (!value) return null;
  let token;
  if (value.startsWith('p-b=') || value.includes(';') || (/^[^=]+=/.test(value) && !/^[^=]+=+$/.test(value))) {
    const matches = value.split(';').map(s => s.trim()).filter(s => s.startsWith('p-b='));
    if (matches.length !== 1) return null;
    token = matches[0].slice(4);
  } else token = value;
  return token && /^[\x21-\x3A\x3C-\x7E]+$/.test(token) ? token : null;
}

export class PoeWebExecutor extends WebSessionExecutor {
  constructor() { super('poe-web', { id: 'poe-web', baseUrl: ORIGIN }); }
  async runSession(input, { sendBillable }) {
    const body = input.body || {};
    const reply = (response, transformedBody = body) => ({ response, url: POE_WEB_URL, headers: { cookie: '[REDACTED]' }, transformedBody });
    const fail = (status, message, code) => reply(errorResponse(status, message, { type: status === 401 ? 'authentication_error' : 'upstream_error', code }));
    const token = parsePoeCookie(input.credentials?.apiKey);
    if (!token) return fail(401, 'A valid Poe p-b cookie is required.', 'missing_cookie');
    const model = input.model || body.model || 'poe-default';
    const bot = POE_WEB_MODELS.find(item => item.id === model)?.bot || model;
    const last = Array.isArray(body.messages) ? body.messages.filter(m => m?.role === 'user').at(-1) : null;
    if (!isString(last?.content) || !last.content) return fail(400, 'Poe requires a text user message.', 'invalid_request');
    const payload = { operationName: 'ChatViewQuery', query: QUERY, variables: { bot, query: last.content } };
    let upstream;
    try {
      upstream = await sendBillable(POE_WEB_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36', origin: ORIGIN, referer: `${ORIGIN}/`, cookie: `p-b=${token}` }, body: JSON.stringify(payload) });
    } catch (error) {
      if (error?.name === 'AbortError' || isQuotaDispatchUnavailable(error)) throw error;
      if (isRefusedRedirect(error)) return fail(401, 'Poe session expired or was rejected. Re-import the cookie.', 'session_expired');
      return fail(502, 'Poe request failed.', 'network_error');
    }
    if (upstream.status === 401 || upstream.status === 403 || (upstream.status >= 300 && upstream.status < 400)) return fail(401, 'Poe session expired or was rejected. Re-import the cookie.', 'session_expired');
    if (!upstream.ok) return fail(upstream.status, `Poe request failed (HTTP ${upstream.status}).`, `HTTP_${upstream.status}`);
    let data;
    try { data = await upstream.json(); } catch { return fail(502, 'Poe returned invalid JSON.', 'invalid_response'); }
    const result = data?.data?.chatWithBot;
    if (data?.errors?.length || !isString(result?.text) || (result.state && !['complete', 'completed'].includes(result.state.toLowerCase()))) return fail(502, 'Poe returned an error or incomplete response.', 'invalid_response');
    const base = { id: `chatcmpl-poe-${Date.now()}`, created: Math.floor(Date.now() / 1000), model };
    if (!(input.stream === true || body.stream === true)) return reply(Response.json({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }] }), payload);
    const chunk = (delta, finish_reason) => ({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] });
    return reply(this.sseReply([chunk({ role: 'assistant', content: result.text }, null), chunk({}, 'stop')]), payload);
  }
}
export default PoeWebExecutor;
