import { BaseExecutor } from "./base.js";
import { createExecutorSender, requestAbortError, withBillableDispatch } from "./sendRequest.js";
import { errorJson, jsonResponse, sanitizeErrorMessage } from "./websession-utils.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const BASE_URL = "https://veoaifree.com";
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const TTS_URL = `${BASE_URL}/video/googletts.php`;
const USER_AGENT =
"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const POLL_INTERVAL_MS = 20_000;
const MAX_POLLS = 30;
const FETCH_TIMEOUT_MS = 30_000;

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
}

function withTimeout(signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason || new Error("Request aborted"));
  const timeout = setTimeout(() => controller.abort(new Error("VeoAIFree request timed out")), FETCH_TIMEOUT_MS);
  if (signal?.aborted) abort();else
  signal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

async function fetchWithTimeout(send, url, init = {}, signal) {
  throwIfAborted(signal);
  const timeout = withTimeout(signal);
  try {
    // The site takes no credential, so redirects stay allowed on uncharged requests.
    return await send(url, { redirect: "follow", ...init, signal: timeout.signal });
  } finally {
    timeout.cleanup();
  }
}

function waitForPoll(signal) {
  throwIfAborted(signal);
  let abort;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, POLL_INTERVAL_MS);
    abort = () => {
      clearTimeout(timeout);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Request aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  }).finally(() => {
    if (abort) signal?.removeEventListener("abort", abort);
  });
}

async function fetchNonce(send, signal) {
  const res = await fetchWithTimeout(send, BASE_URL, { headers: { "User-Agent": USER_AGENT } }, signal);
  const html = await res.text();
  const match = html.match(/nonce":"([a-f0-9]+)"/);
  if (!match) throw new Error("Failed to extract CSRF nonce from veoaifree.com");
  return match[1];
}

async function postAjax(send, nonce, params, signal) {
  const body = new URLSearchParams({ action: "veo_video_generator", nonce, ...params });
  const res = await fetchWithTimeout(send, AJAX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT, Origin: BASE_URL, Referer: `${BASE_URL}/` },
    body: body.toString()
  }, signal);
  return res.text();
}

export function detectIntent(model = "", prompt = "") {
  const m = model.toLowerCase();
  if (m.includes("tts") || m.includes("speech") || m.includes("audio")) return "tts";
  if (m.includes("image") || m.includes("banana") || m.includes("imagen")) return "image";
  if (m.includes("enhance") || m.includes("prompt")) return "enhance";
  if (m.includes("video") || m.includes("veo") || m.includes("seedance")) return "video";
  const p = prompt.toLowerCase();
  if (p.startsWith("generate image") || p.startsWith("create image") || p.startsWith("draw ")) return "image";
  if (p.startsWith("enhance") || p.startsWith("improve prompt")) return "enhance";
  return "video";
}

async function handleVideo({ setup, generate }, nonce, prompt, aspectRatio, signal) {
  const genResult = await postAjax(generate, nonce, { prompt, totalVariations: "1", aspectRatio, actionType: "full-video-generate" }, signal);
  const sceneData = genResult.trim();
  if (!sceneData || sceneData === "0" || sceneData.toLowerCase().includes("error")) return errorJson(502, "Video generation failed");
  for (let i = 0; i < MAX_POLLS; i++) {
    await waitForPoll(signal);
    const pollResult = await postAjax(setup, nonce, { sceneData, actionType: "final-video-results" }, signal).catch(() => "");
    const urls = pollResult.trim().split(/[,\n]/).map((u) => u.trim()).filter((u) => u.startsWith("http"));
    if (urls.length > 0) {
      return jsonResponse({ object: "video.generation", data: urls.map((url) => ({ url, type: "video" })), status: "completed" });
    }
  }
  return errorJson(504, "Video generation timed out after 10 minutes");
}

async function handleImage({ generate }, nonce, prompt, aspectRatio, signal) {
  const result = await postAjax(generate, nonce, { promptIMG: prompt, totalVariationsIMG: "1", aspectRatioIMG: aspectRatio, actionType: "banan-image-generator" }, signal);
  const trimmed = result.trim();
  if (!trimmed || trimmed === "0" || trimmed.toLowerCase().includes("error")) return errorJson(502, "Image generation failed");
  const data = trimmed.split(",").map((s) => s.trim()).filter(Boolean).map((part) => part.startsWith("http") ? { url: part, type: "image" } : { b64_json: part, type: "image" });
  return jsonResponse({ object: "image.generation", data, status: "completed" });
}

async function handleTTS({ generate }, prompt, voice, lang, signal) {
  const res = await fetchWithTimeout(generate, TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT, Origin: BASE_URL, Referer: `${BASE_URL}/free-ai-text-to-speech/` },
    body: JSON.stringify({ text: prompt.slice(0, 10000), voice: voice || "en-US-AvaNeural", lang: lang || "en-US", pitch: "0", speed: "1.0" })
  }, signal);
  if (!res.ok) return errorJson(502, `TTS failed (${res.status})`);
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("audio") || contentType.includes("octet-stream") || contentType.includes("wav")) {
    return new Response(res.body, { headers: { "Content-Type": contentType.includes("wav") ? "audio/wav" : "audio/mpeg", "Content-Disposition": 'attachment; filename="speech.wav"' } });
  }
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (json.audio_data) return jsonResponse({ object: "audio.speech", audio: json.audio_data, status: "completed" });
    if (json.url) return jsonResponse({ object: "audio.speech", url: json.url, status: "completed" });
  } catch {}
  return errorJson(502, "TTS unexpected response format");
}

async function handleEnhance({ generate }, nonce, prompt, signal) {
  const result = await postAjax(generate, nonce, { prompt, actionType: "main-prompt-generation" }, signal);
  const enhanced = result.trim();
  if (!enhanced || enhanced === "0") return errorJson(502, "Prompt enhancement failed");
  return jsonResponse({ object: "prompt.enhancement", enhanced, status: "completed" });
}

function promptFromBody(body = {}) {
  if (isString(body.prompt)) return body.prompt;
  if (isString(body.input)) return body.input;
  const userMsg = Array.isArray(body.messages) ? body.messages.filter((m) => m.role === "user").pop() : null;
  return isString(userMsg?.content) ? userMsg.content : "";
}

function systemFromBody(body = {}) {
  const systemMsg = Array.isArray(body.messages) ? body.messages.filter((m) => m.role === "system").pop() : null;
  return isString(systemMsg?.content) ? systemMsg.content : "";
}

export class VeoAIFreeWebExecutor extends BaseExecutor {
  constructor() {
    super("veoaifree-web", { id: "veoaifree-web", baseUrl: BASE_URL, noAuth: true });
    this.noAuth = true;
  }

  async execute(input) {
    if (input.signal?.aborted) throw requestAbortError(input.signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    return withBillableDispatch(sender, (billed) => this.runChat(input, sender, billed));
  }

  async runChat(input, sender, billed) {
    const body = input.body || {};
    const model = input.model || body.model || "veo-3.1";
    const prompt = promptFromBody(body);
    const systemText = systemFromBody(body);
    const proxyOptions = input.proxyOptions || null;
    if (!prompt.trim()) return { response: errorJson(400, "No prompt provided"), url: AJAX_URL, headers: {}, transformedBody: null };

    // The nonce and result polling are not charged; the generation send is quota-bearing.
    const sends = {
      setup: (url, init) => sender.sendRequest(url, init, proxyOptions, { quotaBearing: false }),
      generate: async (url, init) => billed(await sender.sendRequest(url, init, proxyOptions))
    };

    const intent = detectIntent(model, prompt);
    if (intent === "tts") {
      const response = await handleTTS(sends, prompt, systemText.match(/voice:\s*(\S+)/)?.[1], systemText.match(/lang:\s*(\S+)/)?.[1], input.signal);
      return { response, url: TTS_URL, headers: {}, transformedBody: { intent, model } };
    }

    let nonce;
    try {
      nonce = await fetchNonce(sends.setup, input.signal);
    } catch (err) {
      return { response: errorJson(502, sanitizeErrorMessage(err?.message || "Failed to get nonce")), url: BASE_URL, headers: {}, transformedBody: null };
    }

    const aspectRatio = systemText.match(/aspect[_-]?ratio:\s*(\S+)/i)?.[1] || body.aspect_ratio || body.aspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE";
    const response = intent === "image" ?
    await handleImage(sends, nonce, prompt, String(aspectRatio).replace("VIDEO_", "IMAGE_"), input.signal) :
    intent === "enhance" ?
    await handleEnhance(sends, nonce, prompt, input.signal) :
    await handleVideo(sends, nonce, prompt, aspectRatio, input.signal);
    return { response, url: AJAX_URL, headers: {}, transformedBody: { intent, model } };
  }
}