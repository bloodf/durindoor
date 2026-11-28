import { acquireChatPlaygroundSession as resolveChatPlaygroundHeaders, chatPlaygroundCredential as cookieOrJwt } from "./chatplaygroundSession.js";
export { inspectChatPlaygroundConnection } from "./chatplaygroundSession.js";
import { BaseExecutor } from "./base.js";
import { createExecutorSender, requestAbortError } from "./sendRequest.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { errorResponse } from "../utils/error.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { buildUnifiedPayload, createUnifiedChatStream, parseUnifiedReply, unifiedCompletion, unifiedRequestError } from "./chatplaygroundStream.js";

const API = "https://web.chatplayground.ai/api";
const WEB = "https://web.chatplayground.ai";
const CHAT = `${API}/chat`;
function makeErrorResult(status, message, body, url) {
  return { response: errorResponse(status, message), url, headers: {}, transformedBody: body };
}

export async function validateChatPlaygroundCookie(raw, fetcher = fetch) {
  const auth = await resolveChatPlaygroundHeaders(raw, fetcher);
  if (!auth.ok) {
    const result = { valid: false, status: auth.status };
    if (auth.status >= 300 && auth.status < 400) result.error = "ChatPlayground session was rejected";
    return result;
  }
  let response;
  try {
    response = await fetcher(`${API}/me`, {
      method: "GET", redirect: "manual",
      headers: {
        Accept: "application/json",
        Origin: WEB,
        Referer: `${WEB}/`,
        ...auth.headers,
      },
    });
  } catch {
    return { valid: false, status: 502 };
  }
  if (response.status >= 300 && response.status < 400) return { valid: false, status: response.status, error: "ChatPlayground session was rejected" };
  return { valid: response.ok, status: response.status };
}

/** Chat rows of the model catalog: unified rows carry `slug`, older ones `botId`. */
export function chatPlaygroundCatalog(data) {
  const rows = Array.isArray(data) ? data : data?.data || data?.models || [];
  return rows.map((row) => ({ row, id: isString(row?.slug) && row.slug ? row.slug : row?.botId }))
    .filter(({ row, id }) => isString(id) && id && (!row.group || row.group === "chat"))
    .map(({ row, id }) => ({ id, name: row.displayName || row.modelName || id }));
}

export async function discoverChatPlaygroundModels(credentials, fetcher = fetch) {
  const raw = cookieOrJwt(credentials);
  const auth = await resolveChatPlaygroundHeaders(raw, fetcher);
  if (!auth.ok) {
    if (auth.status >= 300 && auth.status < 400) return { error: "ChatPlayground session was rejected", status: 401 };
    return { error: `Failed to validate ChatPlayground session: ${auth.status}`, status: auth.status };
  }
  const headers = { Accept: "application/json", Origin: WEB, Referer: `${WEB}/`, ...auth.headers };
  const response = await fetcher(`${API}/models`, { method: "GET", headers, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) return { error: "ChatPlayground session was rejected", status: 401 };
  if (!response.ok) return { error: `Failed to fetch ChatPlayground models: ${response.status}`, status: response.status };
  return { models: chatPlaygroundCatalog(await response.json()) };
}

export class ChatPlaygroundExecutor extends BaseExecutor {
  /** @param {Function|null} fetcher test seam replacing the HTTP transport */
  constructor(fetcher = null) {
    super("chatplayground", { baseUrl: CHAT });
    this.fetcher = fetcher;
  }

  async execute(input) {
    const { model, body = {}, credentials = {}, stream = body.stream !== false, signal } = input;
    if (signal?.aborted) throw requestAbortError(signal.reason);
    const sender = createExecutorSender(this, input);
    // Session and catalog requests are setup; only the chat request is quota-bearing.
    const send = (url, init, quotaBearing = false) => sender.sendRequest(url, { signal, ...init }, input.proxyOptions, {
      quotaBearing,
      ...(this.fetcher ? { transport: (options) => this.fetcher(url, options) } : null)
    });
    // The unified route cannot express every Chat Completions request; refuse those unsent.
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const unsupported = unifiedRequestError(messages);
    if (unsupported) return makeErrorResult(400, unsupported, body, CHAT);
    const auth = await resolveChatPlaygroundHeaders(cookieOrJwt(credentials), send, { signal });
    if (signal?.aborted) throw requestAbortError(signal.reason);
    if (!auth.ok) return makeErrorResult(auth.status === 403 ? 403 : auth.status === 429 ? 429 : 401,
      "ChatPlayground session is missing or expired", body, `${API}/me`);
    const validation = await send(`${API}/me`, { headers: { Accept: "application/json", Origin: WEB, Referer: `${WEB}/`, ...auth.headers }, redirect: "manual", signal });
    if (!validation.ok) return makeErrorResult(validation.status === 403 ? 403 : validation.status === 429 ? 429 : 401,
      "ChatPlayground session is missing or expired", body, `${API}/me`);
    const catalogResponse = await send(`${API}/models`, { headers: { Accept: "application/json", Origin: WEB, Referer: `${WEB}/` }, redirect: "manual", signal });
    if (catalogResponse.status >= 300 && catalogResponse.status < 400) return makeErrorResult(401, "ChatPlayground session was rejected", body, `${API}/models`);
    if (!catalogResponse.ok) return makeErrorResult(catalogResponse.status, `ChatPlayground model discovery failed (${catalogResponse.status})`, body, `${API}/models`);
    let catalog;
    try { catalog = await catalogResponse.json(); } catch { return makeErrorResult(502, "Invalid ChatPlayground model catalog", body, `${API}/models`); }
    const wanted = String(model || "").replace(/^(chatplayground|cpl)[/.]/i, "").toLowerCase();
    const row = chatPlaygroundCatalog(catalog).find((entry) => entry.id.toLowerCase() === wanted);
    if (!row) return makeErrorResult(400, `ChatPlayground model not found: ${model || ""}`, body, `${API}/models`);
    const payload = buildUnifiedPayload(messages, row.id);
    const response = await send(CHAT, {
      method: "POST", redirect: "manual", signal, headers: { Accept: stream ? "text/event-stream" : "application/json", "Content-Type": "application/json", Origin: WEB, Referer: `${WEB}/`,
        ...auth.headers }, body: JSON.stringify(payload),
    }, true);
    // Every result after the chat send carries its quota ticket.
    const carry = (result) => {
      transferProviderAttemptDispatch(response, result.response);
      return { ...result, attemptStartedAt: sender.attemptStartedAt };
    };
    if (response.status >= 300 && response.status < 400) return carry(makeErrorResult(401, "ChatPlayground session was rejected", body, CHAT));
    if (!response.ok) return carry(makeErrorResult(response.status, `ChatPlayground API error (${response.status})`, body, CHAT));
    const answered = (reply) => carry({ response: reply, url: CHAT, headers: {}, transformedBody: payload });
    if (stream && response.body) {
      return answered(new Response(createUnifiedChatStream(response.body, model), { headers: { "Content-Type": "text/event-stream" } }));
    }
    const reply = parseUnifiedReply(await response.text());
    if (reply.error) return carry(makeErrorResult(502, `ChatPlayground API error: ${reply.error}`, payload, CHAT));
    return answered(unifiedCompletion(reply, model));
  }
}
