// OpenRouter TTS — via chat completions + audio modality (SSE stream)
import { isNumber, isObject } from "../../../src/shared/utils/typeChecks.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const TTS_CFG = PROVIDER_MEDIA["openrouter"]?.ttsConfig || {};

export default {
  async synthesize(text, model, credentials, _responseFormat, opts = {}) {
    if (!credentials?.apiKey) throw new Error("No OpenRouter API key configured");

    // model format: "tts-model/voice" e.g. "openai/gpt-4o-mini-tts/alloy"
    let ttsModel = TTS_CFG.defaultModel;
    let voice = "alloy";
    if (model && model.includes("/")) {
      const lastSlash = model.lastIndexOf("/");
      const maybVoice = model.slice(lastSlash + 1);
      const maybeModel = model.slice(0, lastSlash);
      if (maybeModel.includes("/")) {
        ttsModel = maybeModel;
        voice = maybVoice;
      } else {
        voice = model;
      }
    } else if (model) {
      voice = model;
    }

    const res = await fetch(TTS_CFG.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials.apiKey}`,
        ...(TTS_CFG.headers || {}),
      },
      body: JSON.stringify({
        model: ttsModel,
        modalities: ["text", "audio"],
        audio: { voice, format: "wav" },
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: text }],
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenRouter TTS failed: ${res.status}`);
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
