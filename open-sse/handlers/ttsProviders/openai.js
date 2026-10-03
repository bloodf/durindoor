// OpenAI TTS — model format: "tts-model/voice"
import { Buffer } from "node:buffer";
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const DEFAULT_TTS_MODEL = PROVIDER_MEDIA.openai?.ttsConfig?.defaultModel;

export default {
  async synthesize(text, model, credentials, envelopeFormat, options = {}) {
    if (!credentials?.apiKey) throw new Error("No OpenAI API key configured");

    let ttsModel = DEFAULT_TTS_MODEL;
    let voice = "alloy";
    if (model?.includes("/")) [ttsModel, voice] = model.split("/");
    else if (model) voice = model;

    const { language, proxyOptions, model: _model, input: _input, voice: requestedVoice, ...bodyOptions } = options;
    const body = { model: ttsModel, voice: requestedVoice || voice, input: text, ...bodyOptions };
    const baseUrl = (credentials.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
    const res = await proxyAwareFetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${credentials.apiKey}` },
      body: JSON.stringify(body),
    }, proxyOptions);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI TTS failed: ${res.status}`);
    }
    if (envelopeFormat !== "json") {
      return { success: true, response: new Response(res.body, { headers: { "Content-Type": res.headers.get("content-type") || "audio/mpeg", "Access-Control-Allow-Origin": "*" } }) };
    }
    const audio = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { base64: audio, format: body.response_format || "mp3" };
  },
};
