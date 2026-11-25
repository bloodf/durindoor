import { createSseFrameReader } from "../../utils/sseFrames.js";
// Codex (ChatGPT Plus/Pro) image generation via Responses API + SSE
import { randomUUID } from "node:crypto";
import { nowSec } from "./_base.js";
import { PROVIDERS } from "../../config/providers.js";
import { CODEX_CLI_VERSION, CODEX_CLI_USER_AGENT } from "../../config/appConstants.js";
import { resolveCodexAccountId } from "../../shared/codexAccountId.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";
import { readBoundedResponseText, sanitizeErrorMessageWithSecrets } from "../../utils/error.js";

const CODEX_RESPONSES_URL = PROVIDERS.codex.baseUrl;
const CODEX_NATIVE_IMAGES_URL = new URL("./images/", CODEX_RESPONSES_URL).href;
const CODEX_USER_AGENT = CODEX_CLI_USER_AGENT;
const CODEX_VERSION = CODEX_CLI_VERSION;
const CODEX_ORIGINATOR = "codex_cli_rs";
const CODEX_MODEL_SUFFIX = "-image";
const CODEX_REF_DETAIL = "high";
const HOSTED_IMAGE_MODELS = new Set([
  "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst",
  "gpt-image-2.6-flare", "gpt-image-2.6-sunburst"
]);

const HOSTED_MAIN_MODEL = "gpt-6-sol";
const FALLBACK_MAIN_MODEL = "gpt-5.6-terra";

// Responses model that drives the hosted image_generation tool. Operators can
// override it with CODEX_IMAGE_RESPONSES_MODEL (decolua/9router#4866); blank
// values keep the default.
function hostedMainModel() {
  return process.env.CODEX_IMAGE_RESPONSES_MODEL?.trim() || HOSTED_MAIN_MODEL;
}

function stripImageSuffix(model) {
  return model.endsWith(CODEX_MODEL_SUFFIX) ? model.slice(0, -CODEX_MODEL_SUFFIX.length) : model;
}

function toDataUrl(input) {
  if (!input || !isString(input)) return null;
  if (/^data:image\//i.test(input) || /^https?:\/\//i.test(input)) return input;
  return `data:image/png;base64,${input}`;
}

function collectImageRefs(body) {
  const refs = Array.isArray(body.images) ? body.images.map(toDataUrl).filter(Boolean) : [];
  const single = toDataUrl(body.image);
  if (single) refs.push(single);
  return refs;
}

function nativeImageEndpoint(model, body, streamToClient) {
  if (!body || streamToClient || !HOSTED_IMAGE_MODELS.has(model)) return null;
  if ((body.n != null && body.n !== 1) || (body.size && body.size !== "auto") ||
    (body.output_format && String(body.output_format).toLowerCase() !== "png") ||
    (body.background && !["auto", "opaque"].includes(body.background)) ||
    (body.quality && !["auto", "low", "medium", "high"].includes(body.quality)) ||
    body.output_compression != null) return null;
  return collectImageRefs(body).length ? "edits" : "generations";
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
  const frameReader = createSseFrameReader();
  let frames = [];
  let imageB64 = null;
  let imageError;
  let hasText = false;
  let bytesReceived = 0;
  let lastProgressLogMs = 0;
  let eof = false;
  while (true) {
    if (!frames.length) {
      if (eof) throw new Error("Codex stream ended before response.completed");
      const { done, value } = await reader.read();
      eof = done;
      bytesReceived += value?.byteLength || 0;
      frames = frameReader.push(done ? decoder.decode() : decoder.decode(value, { stream: true }));
      if (done) frames.push(...frameReader.flush());
      continue;
    }
    const frame = frames.shift();
    const text = frame.data.trim();
    if (!text) continue;
    let eventName = frame.eventName?.trim();
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
    if (eventName === "response.output_text.delta" && data.delta?.trim?.()) hasText = true;
    if (eventName === "response.output_item.done" && data.item?.type === "image_generation_call") {
      if (data.item.result) imageB64 = data.item.result;
      else imageError ||= data.item.error?.message;
    }
    if (eventName === "response.output_item.done" && data.item?.content?.some?.((part) => part.type === "output_text" && part.text?.trim?.())) hasText = true;
    if (eventName === "response.completed") {
      if (data.response?.status && data.response.status !== "completed") throw new Error(`Codex response ${data.response.status}`);
      for (const item of data.response?.output || []) {
        if (item.type === "image_generation_call") {
          if (item.result) imageB64 = item.result;
          else imageError ||= item.error?.message;
        }
        if (item.content?.some?.((part) => part.type === "output_text" && part.text?.trim?.())) hasText = true;
      }
      if (!imageB64) {
        throw new Error(imageError || (hasText
          ? "Codex returned text instead of an image."
          : "Codex did not return an image. Account may not be entitled (Plus/Pro required)."));
      }
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
  buildUrl: (model, _creds, body, { streamToClient } = {}) => {
    const endpoint = nativeImageEndpoint(model, body, streamToClient);
    return endpoint ? new URL(endpoint, CODEX_NATIVE_IMAGES_URL).href : CODEX_RESPONSES_URL;
  },
  buildHeaders: (creds, requestBody) => {
    assertNotFreePlan(creds?.providerSpecificData);
    const accountId = resolveCodexAccountId(creds?.providerSpecificData, creds?.idToken);
    const headers = {
      "accept": requestBody?.input ? "text/event-stream, application/json" : "application/json",
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
  buildBody: (model, body, { streamToClient } = {}) => {
    const refs = collectImageRefs(body);
    const endpoint = nativeImageEndpoint(model, body, streamToClient);
    if (endpoint) {
      const native = {
        model,
        prompt: body.prompt,
        n: 1,
        size: "auto",
        quality: body.quality || "auto",
        background: body.background || "auto"
      };
      if (endpoint === "edits") native.images = refs.map((image_url) => ({ image_url }));
      else native.output_format = "png";
      return native;
    }
    const detail = body.image_detail || CODEX_REF_DETAIL;
    const imgTool = { type: "image_generation", output_format: (body.output_format || "png").toLowerCase() };
    const hostedImageModel = HOSTED_IMAGE_MODELS.has(model);
    if (hostedImageModel) {
      imgTool.model = model;
      imgTool.action = refs.length ? "edit" : "generate";
    }
    if (body.size && body.size !== "") imgTool.size = body.size;
    if (body.quality && body.quality !== "") imgTool.quality = body.quality;
    if (body.background && body.background !== "") imgTool.background = body.background;
    return {
      model: hostedImageModel ? hostedMainModel() : stripImageSuffix(model),
      instructions: "",
      input: [{ type: "message", role: "user", content: buildContent(body.prompt, refs, detail) }],
      tools: [imgTool],
      tool_choice: hostedImageModel ? { type: "image_generation" } : "auto",
      parallel_tool_calls: false,
      prompt_cache_key: randomUUID(),
      stream: true,
      store: false,
      reasoning: null
    };
  },
  buildFallbackBody(requestBody, status, message) {
    if (status !== 400 || requestBody?.model !== hostedMainModel() ||
      requestBody.model === FALLBACK_MAIN_MODEL ||
      !HOSTED_IMAGE_MODELS.has(requestBody.tools?.[0]?.model) ||
      !/model is not supported when using Codex/i.test(message)) return null;
    return { ...requestBody, model: FALLBACK_MAIN_MODEL };
  },
  // Reuse the core's buffered settlement for native JSON, and its streaming
  // settlement for Responses SSE.
  async parseResponse(response, { log, signal, streamToClient, onStreamComplete, onReceipt, credentials, requestBody }) {
    if (requestBody && !requestBody.input) {
      const raw = await readBoundedResponseText(response, {
        signal, maxBytes: 32 * 1024 * 1024, timeoutMs: 30000, throwOnTimeout: true
      });
      const result = JSON.parse(raw);
      onReceipt?.(result, "");
      if (!Array.isArray(result.data) || !result.data.some((image) => image?.b64_json || image?.url)) {
        throw new Error(result.error?.message || "Codex Images API returned no image.");
      }
      return { created: result.created || nowSec(), data: result.data };
    }
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