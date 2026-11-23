import { applyOpenRouterRouting } from "../../services/openrouterRouting.js";
// OpenRouter TTS — chat completions with the audio modality (SSE stream).
// The stream carries the provider receipt (tokens + cost) the audio budget
// gate needs, so it stays the primary transport. A model OpenRouter refuses
// there ("is a text-to-speech model and cannot be used with the
// chat/completions endpoint") is synthesized through the dedicated
// /audio/speech endpoint instead.
import { Buffer } from "node:buffer";
import { isNumber, isObject } from "../../../src/shared/utils/typeChecks.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const TTS_CFG = PROVIDER_MEDIA["openrouter"]?.ttsConfig || {};
const BASE = (TTS_CFG.baseUrl || "https://openrouter.ai/api/v1/chat/completions").replace(/\/chat\/completions$/, "");
const VOICES = new Set(["alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse"]);

// "vendor/model" is a model; "vendor/model/voice" is a model plus a known voice.
// A custom (dashboard-added) model id has no voice segment, so it must not be
// mistaken for one.
function splitModelVoice(input, fallbackModel) {
  if (!input) return { ttsModel: fallbackModel, voice: "alloy" };
  const parts = input.split("/");
  if (parts.length >= 3 && VOICES.has(parts.at(-1).toLowerCase())) {
    return { ttsModel: parts.slice(0, -1).join("/"), voice: parts.at(-1).toLowerCase() };
  }
  if (parts.length >= 2) return { ttsModel: input, voice: undefined };
  return { ttsModel: fallbackModel, voice: input };
}

// OpenRouter refuses a pure text-to-speech model on the chat completions
// endpoint. That model can still be synthesized through /audio/speech.
const TTS_ONLY_MODEL_RE = /text-to-speech model/i;

async function synthesizeViaSpeechEndpoint(text, ttsModel, voice, headers, opts) {
  const speechBody = { model: ttsModel, input: text };
  if (voice) speechBody.voice = voice;
  const res = await fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify(speechBody),
    signal: opts.signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenRouter TTS failed: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const format = ct.includes("wav") ? "wav" : ct.includes("ogg") ? "ogg" : "mp3";
  // The speech endpoint returns no usage receipt, so the cost stays unknown.
  return { base64: buf.toString("base64"), format };
}

export default {
  async synthesize(text, model, credentials, _responseFormat, opts = {}) {
    if (!credentials?.apiKey) throw new Error("No OpenRouter API key configured");

    const { ttsModel, voice } = splitModelVoice(model, TTS_CFG.defaultModel);
    const routed = applyOpenRouterRouting({ model: ttsModel, provider: opts.requestProvider }, opts.routingPolicy, "completion");
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.apiKey}`,
      ...(TTS_CFG.headers || {}),
    };

    const requestBody = {
      model: ttsModel,
      modalities: ["text", "audio"],
      audio: { voice: voice || "alloy", format: "wav" },
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: text }],
    };
    if (routed.provider) requestBody.provider = routed.provider;
    const res = await fetch(TTS_CFG.baseUrl || `${BASE}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: opts.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const message = err?.error?.message || `OpenRouter TTS failed: ${res.status}`;
      // A pure text-to-speech model is refused here and is only served by the
      // dedicated speech endpoint.
      if (res.status === 400 && TTS_ONLY_MODEL_RE.test(message)) {
        if (routed.provider?.zdr || routed.provider?.quantizations) throw Object.assign(new Error("OpenRouter speech endpoint cannot enforce the routing policy"), { status: 400 });
        return synthesizeViaSpeechEndpoint(text, ttsModel, voice, headers, opts);
      }
      throw new Error(message);
    }

    // Capture the provider receipt before reducing the completed SSE to audio.
    const chunks = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminal = false;
    let usage;
    let id;
    const inspect = (line) => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload) return;
      if (payload === "[DONE]") { terminal = true; return; }
      const json = JSON.parse(payload);
      if (json.error) throw new Error(json.error.message || "OpenRouter TTS stream failed");
      if (json.usage !== undefined && json.usage !== null) {
        if (!isObject(json.usage) || Array.isArray(json.usage)) throw new Error("Invalid OpenRouter TTS usage");
        usage = { ...usage, ...json.usage };
      }
      if (json.id !== undefined) id = json.id;
      const audioData = json.choices?.[0]?.delta?.audio?.data;
      if (audioData) chunks.push(audioData);
    };
    try {
      while (true) {
        opts.signal?.throwIfAborted();
        const { done, value } = await reader.read();
        opts.signal?.throwIfAborted();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) inspect(line);
        if (done) { if (buffer) inspect(buffer); break; }
      }
      if (!terminal) throw new Error("OpenRouter TTS stream ended without completion");
      if (chunks.length === 0) throw new Error("OpenRouter TTS returned no audio data");
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
    const receipt = {};
    if (id !== undefined) receipt.id = id;
    if (usage !== undefined) receipt.usage = usage;
    const cost = usage?.cost;
    if (cost !== undefined && (!isNumber(cost) || !Number.isFinite(cost) || cost < 0)) throw new Error("Invalid OpenRouter TTS cost");
    const accounting = { tokens: usage || {} };
    if (cost !== undefined) {
      accounting.cost = cost;
      accounting.costStatus = "known";
      accounting.costSource = "provider:openrouter";
    }
    if (Object.keys(receipt).length) accounting.meta = { providerReceipt: receipt };
    return {
      base64: chunks.join(""), format: "wav",
      accounting,
    };
  },
};
