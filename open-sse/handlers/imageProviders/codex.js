// Codex (ChatGPT Plus/Pro) image generation via Responses API + SSE
import { randomUUID } from "node:crypto";
import { nowSec } from "./_base.js";
import { PROVIDERS } from "../../config/providers.js";
import { CODEX_CLI_VERSION, CODEX_CLI_USER_AGENT } from "../../config/appConstants.js";
import { resolveCodexAccountId } from "../../shared/codexAccountId.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";
import { sanitizeErrorMessageWithSecrets } from "../../utils/error.js";

const CODEX_RESPONSES_URL = PROVIDERS["codex"].baseUrl;
const CODEX_USER_AGENT = CODEX_CLI_USER_AGENT;
const CODEX_VERSION = CODEX_CLI_VERSION;
const CODEX_ORIGINATOR = "codex_cli_rs";
const CODEX_MODEL_SUFFIX = "-image";
const CODEX_REF_DETAIL = "high";

function stripImageSuffix(model) {
  return model.endsWith(CODEX_MODEL_SUFFIX) ? model.slice(0, -CODEX_MODEL_SUFFIX.length) : model;
}

function toDataUrl(input) {
  if (!input || !isString(input)) return null;
  if (/^data:image\//i.test(input) || /^https?:\/\//i.test(input)) return input;
  return `data:image/png;base64,${input}`;
}

function buildContent(prompt, refs, detail = CODEX_REF_DETAIL) {
  const content = [];
  refs.forEach((url, index) => {
    content.push({ type: "input_text", text: `<image name=image${index + 1}>` });
    content.push({ type: "input_image", image_url: url, detail });
    content.push({ type: "input_text", text: "</image>" });
  });
  content.push({ type: "input_text", text: prompt });
  return content;
}

// One parser serves buffered and streaming responses. Only response.completed
// with an image is success; an image item followed by EOF is not completion.
async function* parseStream(reader, log, onReceipt) {
  const decoder = new TextDecoder();
  let buffer = "";
  let imageB64 = null;
  let bytesReceived = 0;
  let lastProgressLogMs = 0;
  let eof = false;
  while (true) {
    const separator = /\r?\n\r?\n/.exec(buffer);
    if (!separator) {
      if (eof) throw new Error("Codex stream ended before response.completed");
      const { done, value } = await reader.read();
      eof = done;
      bytesReceived += value?.byteLength || 0;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      continue;
    }
    const block = buffer.slice(0, separator.index);
    buffer = buffer.slice(separator.index + separator[0].length);
    let eventName;
    const lines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
    }
    if (!lines.length) continue;
    const text = lines.join("\n");
    if (text === "[DONE]") throw new Error("Codex stream ended before response.completed");
    const data = JSON.parse(text);
    eventName ||= data.type;
    // Keep receipts before discarding provider envelopes or image tool items.
    onReceipt?.(data.item, "item.");
    for (const item of data.response?.output || []) onReceipt?.(item, "response.output[].");
    onReceipt?.(data, "");
    onReceipt?.(data.response, "response.");
    if (eventName === "error" || eventName === "response.failed" || eventName === "response.incomplete") {
      throw new Error(data.response?.error?.message || data.error?.message || data.message || `Codex ${eventName}`);
    }
    if (eventName === "response.output_item.done" && data.item?.type === "image_generation_call" && data.item.result) {
      imageB64 = data.item.result;
    }
    if (eventName === "response.completed") {
      if (data.response?.status && data.response.status !== "completed") throw new Error(`Codex response ${data.response.status}`);
      for (const item of data.response?.output || []) {
        if (item.type === "image_generation_call" && item.result) imageB64 = item.result;
      }
      if (!imageB64) throw new Error("Codex did not return an image. Account may not be entitled (Plus/Pro required).");
      return { created: nowSec(), data: [{ b64_json: imageB64 }] };
    }
    const now = Date.now();
    if (eventName && now - lastProgressLogMs > 200) {
      lastProgressLogMs = now;
      log?.info?.("IMAGE", `codex progress: ${eventName}`);
      yield { event: "progress", data: { stage: eventName, bytesReceived } };
    }
    if (eventName === "response.image_generation_call.partial_image" && data.partial_image_b64) {
      yield { event: "partial_image", data: { b64_json: data.partial_image_b64, index: data.partial_image_index } };
    }
  }
}

// No eager pump/tee: client demand drives the parser. Completion never rejects.
// The terminal parser outcome is fixed before awaiting persistence; cancellation
// after provider success cannot retroactively turn a committed operation into abort.
// Redact only public terminal messages; completion keeps the original errors.
function buildSseResponse(providerResponse, log, onComplete, onReceipt, credentials) {
  const reader = providerResponse.body.getReader();
  const parser = parseStream(reader, log, onReceipt);
  const enc = new TextEncoder();
  let response;
  let cancelled = false;
  let terminal;
  let finishing;
  let resolveCompletion;
  const completion = new Promise((resolve) => { resolveCompletion = resolve; });
  const finish = (outcome) => {
    if (finishing) return finishing;
    terminal = outcome;
    finishing = (async () => {
      try {
        await onComplete?.(outcome, response);
      } catch (error) {
        outcome.callbackError = error;
        outcome.status = "failure";
        outcome.error = error;
      } finally {
        try { await reader.cancel(); } catch { /* The upstream may already be errored. */ }
        reader.releaseLock();
        resolveCompletion(outcome);
      }
      return outcome;
    })();
    return finishing;
  };
  const stream = new ReadableStream({
    async pull(controller) {
      const send = (event, data) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const next = await parser.next();
        if (cancelled) return;
        if (!next.done) {
          send(next.value.event, next.value.data);
          return;
        }
        const outcome = await finish({ status: "success", value: next.value });
        if (cancelled) return;
        if (outcome.callbackError) send("error", { message: sanitizeErrorMessageWithSecrets(outcome.callbackError.message || "Accounting failed", [credentials?.apiKey, credentials?.accessToken, credentials?.refreshToken, credentials?.idToken]) });
        else send("done", next.value);
        controller.close();
      } catch (error) {
        if (cancelled) return;
        await finish({ status: error?.name === "AbortError" ? "abort" : "failure", error });
        if (!cancelled) {
          send("error", { message: sanitizeErrorMessageWithSecrets(error?.message || "Stream failed", [credentials?.apiKey, credentials?.accessToken, credentials?.refreshToken, credentials?.idToken]) });
          controller.close();
        }
      }
    },
    async cancel(reason) {
      cancelled = true;
      if (!terminal) await finish({ status: "abort", error: reason });
      else await finishing;
    }
  }, { highWaterMark: 0 });
  response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*"
    }
  });
  return { sseResponse: response, completion };
}

// Codex image_generation always 403s on a free ChatGPT plan (Plus/Pro/Business
// required). Reject before dispatch instead of burning a round trip on an
// account we already know will fail, tagged 403 so combo fails over to the
// next candidate rather than surfacing a flat 400.
// Upstream provenance: diegosouzapw/OmniRoute 79b2e92c4 (#11948).
function assertNotFreePlan(providerSpecificData) {
  const planType = String(
    providerSpecificData?.chatgptPlanType || providerSpecificData?.workspacePlanType || ""
  ).toLowerCase();
  if (planType !== "free") return;
  const err = new Error("Codex image_generation is unavailable on free-plan accounts");
  err.status = 403;
  throw err;
}

export default {
  stream: true,
  buildUrl: () => CODEX_RESPONSES_URL,
  buildHeaders: (creds) => {
    assertNotFreePlan(creds?.providerSpecificData);
    const accountId = resolveCodexAccountId(creds?.providerSpecificData, creds?.idToken);
    const headers = {
      "accept": "text/event-stream, application/json",
      "authorization": `Bearer ${creds?.accessToken || ""}`,
      "content-type": "application/json",
      "originator": CODEX_ORIGINATOR,
      "session_id": randomUUID(),
      "user-agent": CODEX_USER_AGENT,
      "version": CODEX_VERSION,
      "x-client-request-id": randomUUID()
    };
    if (accountId) headers["chatgpt-account-id"] = accountId;
    return headers;
  },
  buildBody: (model, body) => {
    const refs = [];
    if (Array.isArray(body.images)) body.images.forEach((i) => {const u = toDataUrl(i);if (u) refs.push(u);});
    const single = toDataUrl(body.image);
    if (single) refs.push(single);
    const detail = body.image_detail || CODEX_REF_DETAIL;
    const imgTool = { type: "image_generation", output_format: (body.output_format || "png").toLowerCase() };
    if (body.size && body.size !== "") imgTool.size = body.size;
    if (body.quality && body.quality !== "") imgTool.quality = body.quality;
    if (body.background && body.background !== "") imgTool.background = body.background;
    return {
      model: stripImageSuffix(model),
      instructions: "",
      input: [{ type: "message", role: "user", content: buildContent(body.prompt, refs, detail) }],
      tools: [imgTool],
      tool_choice: "auto",
      parallel_tool_calls: false,
      prompt_cache_key: randomUUID(),
      stream: true,
      store: false,
      reasoning: null
    };
  },
  // Custom: codex parses SSE → either pipe to client or collect b64
  async parseResponse(response, { log, streamToClient, onStreamComplete, onReceipt, credentials }) {
    if (streamToClient) return buildSseResponse(response, log, onStreamComplete, onReceipt, credentials);
    const reader = response.body.getReader();
    try {
      const parser = parseStream(reader, log, onReceipt);
      while (true) {
        const next = await parser.next();
        if (next.done) return next.value;
      }
    } finally {
      try { await reader.cancel(); } catch { /* Preserve the parser error. */ }
      reader.releaseLock();
    }
  },
  normalize: (responseBody) => responseBody
};