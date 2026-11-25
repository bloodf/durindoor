import { randomUUID } from "node:crypto";
import { isString, isNumber, isRecord } from "../../src/shared/utils/typeChecks.js";
import { BaseExecutor, waitForRetryDelay } from "./base.js";
import { createExecutorSender } from "./sendRequest.js";
import { errorJson, jsonResponse } from "./websession-utils.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";

const API = "https://api.replicate.com";
// `Prefer: wait=60` lets Replicate hold the response headers for a full minute.
const HEADER_TIMEOUT_MS = Math.max(FETCH_CONNECT_TIMEOUT_MS, 90_000);
const STREAM_ORIGINS = ["https://streaming.api.replicate.com", "https://stream.replicate.com"];
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

// Prediction links are provider-controlled. Never forward a token to any other origin,
// and reject redirects so the HTTP client cannot bypass this check.
function trustedUrl(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function textOutput(output) {
  if (isString(output)) return output;
  if (Array.isArray(output) && output.every((item) => isString(item))) return output.join("");
  throw new Error("Replicate returned non-text output");
}

function promptInput(body) {
  if (body?.tools?.length || body?.functions?.length || !Array.isArray(body?.messages)) return null;
  const systems = [];
  const turns = [];
  for (const message of body.messages) {
    if (message.tool_calls || !["system", "developer", "user", "assistant"].includes(message.role)) return null;
    let content = message.content;
    if (Array.isArray(content)) {
      if (content.some((part) => !["text", "input_text"].includes(part?.type) || !isString(part.text))) return null;
      content = content.map((part) => part.text).join("");
    }
    if (!isString(content)) return null;
    if (["system", "developer"].includes(message.role)) systems.push(content);
    else turns.push({ role: message.role, content });
  }
  if (!turns.length) return null;
  const prompt = turns.length === 1 && turns[0].role === "user" ? turns[0].content :
    turns.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`).join("\n") + (turns.at(-1).role === "user" ? "\nAssistant:" : "");
  const input = { prompt };
  if (systems.length) input.system_prompt = systems.join("\n\n");
  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  if (isNumber(maxTokens)) input.max_tokens = maxTokens;
  if (isNumber(body.temperature)) input.temperature = body.temperature;
  if (isNumber(body.top_p)) input.top_p = body.top_p;
  return input;
}

function completion(model, content) {
  return { id: `chatcmpl-replicate-${randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
}

function streamCompletion(model, source, signal) {
  const id = `chatcmpl-replicate-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const aborter = new AbortController();
  const onAbort = () => aborter.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const output = new ReadableStream({
    async start(controller) {
      const send = (value) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      const chunk = (delta, finish_reason = null) => send({ id, created, model, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] });
      try {
        signal?.throwIfAborted();
        chunk({ role: "assistant" });
        await source((text) => chunk({ content: text }), aborter.signal);
        aborter.signal.throwIfAborted();
        chunk({}, "stop");
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        if (signal?.aborted || aborter.signal.aborted) controller.error(error);
        else { send({ error: { message: error.message, type: "upstream_error" } }); controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); }
      } finally { signal?.removeEventListener("abort", onAbort); }
    },
    cancel() { aborter.abort(); signal?.removeEventListener("abort", onAbort); },
  });
  return new Response(output, { headers: { "Content-Type": "text/event-stream" } });
}

async function readEvents(response, emit, signal) {
  if (!response.body) throw new Error("Replicate returned an empty stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", onAbort, { once: true });
  let buffer = "";
  let hasOutput = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      // Normalize CRLF only after buffering, including pairs split across chunks.
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        let event = "message";
        const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        const payload = data.join("\n");
        if (event === "output" && data.length) {
          hasOutput ||= Boolean(payload.trim());
          emit(payload);
        }
        if (event === "error") throw new Error("Replicate prediction failed");
        if (event === "done") {
          let details;
          try { details = JSON.parse(payload); } catch { throw new Error("Invalid Replicate done event"); }
          // Replicate documents {} for success and a reason for other outcomes.
          if (!hasOutput || !isRecord(details) || Object.keys(details).length) {
            throw new Error("Replicate stream did not complete successfully");
          }
          return;
        }
      }
      if (done) break;
    }
    throw new Error("Replicate stream ended before completion");
  } finally { signal?.removeEventListener("abort", onAbort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class ReplicateExecutor extends BaseExecutor {
  constructor() { super("replicate", { id: "replicate", baseUrl: `${API}/v1`, timeoutMs: HEADER_TIMEOUT_MS }); }

  async execute(input) {
    const { model, body, stream, credentials, signal, proxyOptions } = input;
    const sender = createExecutorSender(this, input);
    const validModel = isString(model) && /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(model);
    const url = validModel ? `${API}/v1/models/${model}/predictions` : `${API}/v1/models`;
    const headers = { Authorization: `Bearer ${credentials?.apiKey || credentials?.accessToken || ""}`, "Content-Type": "application/json" };
    if (!stream) headers.Prefer = "wait=60";
    const prompt = promptInput(body);
    const transformedBody = { input: prompt };
    if (stream) transformedBody.stream = true;
    const result = (response, terminalProvenance) => ({ response, url, headers, transformedBody, terminalProvenance, attemptStartedAt: sender.attemptStartedAt });
    if (!validModel) return result(errorJson(400, "Replicate model must be an official owner/name", "invalid_request"));
    if (!prompt) return result(errorJson(400, "Replicate supports text messages without tools", "invalid_request"));
    const send = (target, options, quotaBearing = false) =>
      sender.sendRequest(target, { ...options, redirect: "manual" }, proxyOptions, { quotaBearing });
    // The creation POST is the single billable dispatch of a Replicate
    // prediction, so it is the only send that consumes a quota reservation.
    // Polling and stream retrieval read that same prediction and stay
    // outside the charge.
    //
    // A local quota denial is a gateway capacity decision, not provider
    // evidence: the reservation is refused before the transport call, so no
    // request reaches Replicate. The error keeps its type, so chatCore
    // reports local quota unavailability instead of an upstream failure.
    const created = await send(url, { method: "POST", headers, body: JSON.stringify(transformedBody), signal }, true);
    // The physical creation response owns the dispatch ticket. Every response
    // returned below replaces it, so the ticket has to follow the
    // replacement; otherwise the reservation is orphaned and never settled
    // exactly once.
    const carryTicket = (returned) => {
      transferProviderAttemptDispatch(created, returned);
      return returned;
    };
    if (!created.ok) return result(carryTicket(errorJson(created.status >= 300 && created.status < 400 ? 502 : created.status, `Replicate request failed (HTTP ${created.status})`)));
    let prediction;
    try { prediction = await created.json(); } catch { return result(carryTicket(errorJson(502, "Invalid Replicate prediction"))); }
    if (!isString(prediction?.status)) return result(carryTicket(errorJson(502, "Invalid Replicate prediction")));
    if (stream && !TERMINAL.has(prediction.status) && prediction.urls?.stream) {
      const streamUrl = STREAM_ORIGINS.map((origin) => trustedUrl(prediction.urls.stream, origin)).find(Boolean);
      if (!streamUrl) return result(carryTicket(errorJson(502, "Unexpected Replicate stream URL")));
      const response = await send(streamUrl, { headers: { Authorization: headers.Authorization, Accept: "text/event-stream" }, signal });
      if (!response.ok) return result(carryTicket(errorJson(response.status >= 300 && response.status < 400 ? 502 : response.status, "Replicate stream request failed")));
      return result(carryTicket(streamCompletion(model, (emit, streamSignal) => readEvents(response, emit, streamSignal), signal)), "validated");
    }
    const deadline = Date.now() + 120000;
    while (!TERMINAL.has(prediction.status) && Date.now() < deadline) {
      const pollUrl = trustedUrl(prediction.urls?.get, API);
      if (!pollUrl) return result(carryTicket(errorJson(502, "Unexpected Replicate polling URL")));
      await waitForRetryDelay(1000, signal);
      const response = await send(pollUrl, { headers: { Authorization: headers.Authorization }, signal });
      if (!response.ok) return result(carryTicket(errorJson(response.status >= 300 && response.status < 400 ? 502 : response.status, "Replicate polling failed")));
      try { prediction = await response.json(); } catch { return result(carryTicket(errorJson(502, "Invalid Replicate prediction"))); }
      if (!isString(prediction?.status)) return result(carryTicket(errorJson(502, "Invalid Replicate prediction")));
    }
    if (prediction.status !== "succeeded") return result(carryTicket(errorJson(TERMINAL.has(prediction.status) ? 502 : 504, `Replicate prediction ${prediction.status || "timed out"}`)));
    let content;
    try { content = textOutput(prediction.output); } catch (error) { return result(carryTicket(errorJson(502, error.message))); }
    if (!content.trim() || prediction.error != null) return result(carryTicket(errorJson(502, "Invalid Replicate prediction output")));
    return result(carryTicket(stream ? streamCompletion(model, async (emit) => emit(content), signal) : jsonResponse(completion(model, content))), "validated");
  }
}
