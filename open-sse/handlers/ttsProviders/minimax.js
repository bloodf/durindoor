import { Buffer } from "node:buffer";
import { isString } from "../../../src/shared/utils/typeChecks.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

function hexToBase64(audioHex) {
  const clean = isString(audioHex) ? audioHex.trim() : "";
  if (!clean) throw new Error("MiniMax TTS returned no audio");
  if (clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) throw new Error("MiniMax TTS returned invalid audio");
  return Buffer.from(clean, "hex").toString("base64");
}

// MiniMax T2A HTTP returns hex audio synchronously and SSE when stream=true.
export default async function minimaxTts({ baseUrl, apiKey, text, modelId, voiceId, proxyOptions, ...options }) {
  const { language, model: _model, input: _input, voice, response_format, responseFormat: _responseFormat, speed, ...requested } = options;
  const voiceSetting = { voice_id: voice || voiceId || "English_expressive_narrator", speed: speed ?? 1, vol: 1, pitch: 0, ...(requested.voice_setting || {}) };
  const audioSetting = { sample_rate: 32000, bitrate: 128000, format: response_format || "mp3", channel: 1, ...(requested.audio_setting || {}) };
  const body = {
    model: modelId || "speech-2.8-hd", text, stream: false, language_boost: language || "auto", output_format: "hex",
    ...requested, voice_setting: voiceSetting, audio_setting: audioSetting,
  };
  const res = await proxyAwareFetch(baseUrl, {
    method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify(body),
  }, proxyOptions);
  if (body.stream) {
    if (!res.ok) throw new Error(await res.text() || `MiniMax TTS error (${res.status})`);
    return { success: true, response: new Response(res.body, { headers: { "Content-Type": res.headers.get("content-type") || "text/event-stream", "Access-Control-Allow-Origin": "*" } }) };
  }
  const rawText = await res.text();
  let data = {};
  if (rawText) try {data = JSON.parse(rawText);} catch {}
  const baseResp = data.base_resp || data.baseResp || {};
  const statusCode = Number(baseResp.status_code ?? baseResp.statusCode ?? 0);
  const statusMessage = baseResp.status_msg || baseResp.statusMsg || data.message || "";
  if (!res.ok) throw new Error(statusMessage || rawText || `MiniMax TTS error (${res.status})`);
  if (statusCode !== 0) throw new Error(statusMessage || "MiniMax TTS upstream error");
  return { base64: hexToBase64(data.data?.audio), format: data.extra_info?.audio_format || data.extraInfo?.audioFormat || audioSetting.format };
}