import { Buffer } from "node:buffer";
import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

function hexToBase64(audioHex) {
  const clean = isString(audioHex) ? audioHex.trim() : "";
  if (!clean) throw new Error("MiniMax TTS returned no audio");
  if (clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) throw new Error("MiniMax TTS returned invalid audio");
  return Buffer.from(clean, "hex").toString("base64");
}

function accountingFrom(data) {
  if (data.usage != null && (!isObject(data.usage) || Array.isArray(data.usage))) throw new Error("Invalid MiniMax TTS usage");
  const extra = data.extra_info ?? data.extraInfo;
  const milliseconds = extra?.audio_length ?? extra?.audioLength;
  const characters = extra?.usage_characters ?? extra?.usageCharacters;
  if (characters !== undefined && (!isNumber(characters) || !Number.isSafeInteger(characters) || characters < 0)) throw new Error("Invalid MiniMax TTS character count");
  if (milliseconds !== undefined && (!isNumber(milliseconds) || !Number.isFinite(milliseconds) || milliseconds < 0)) throw new Error("Invalid MiniMax TTS duration");
  const receipt = {};
  if (data.usage !== undefined) receipt.usage = data.usage;
  if (extra !== undefined) receipt.extra_info = extra;
  if (data.trace_id !== undefined) receipt.trace_id = data.trace_id;
  const nativeUnits = {};
  if (milliseconds !== undefined) nativeUnits.audioSeconds = milliseconds / 1000;
  if (characters !== undefined) nativeUnits.characters = characters;
  const accounting = { tokens: data.usage ?? {}, nativeUnits };
  if (Object.keys(receipt).length) accounting.meta = { providerReceipt: receipt };
  return accounting;
}

// Observe only bytes consumed by the caller. Cancellation never commits success.
function streamingResult(res, signal) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;
  let settled = false;
  let accounting = {};
  let resolveCompletion;
  const accountingCompletion = new Promise((resolve) => { resolveCompletion = resolve; });
  const finish = (status) => {
    if (settled) return;
    settled = true;
    signal?.removeEventListener("abort", abort);
    resolveCompletion({ status, accounting });
  };
  const abort = () => { finish("aborted"); void reader.cancel(signal.reason).catch(() => {}); };
  const inspect = (line) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    const data = JSON.parse(payload);
    const code = data.base_resp?.status_code ?? data.baseResp?.statusCode;
    if (code !== undefined && Number(code) !== 0) throw new Error("MiniMax TTS upstream stream error");
    const next = accountingFrom(data);
    const merged = { ...next, tokens: { ...accounting.tokens, ...next.tokens }, nativeUnits: { ...accounting.nativeUnits, ...next.nativeUnits } };
    if (accounting.meta || next.meta) merged.meta = { providerReceipt: { ...accounting.meta?.providerReceipt, ...next.meta?.providerReceipt } };
    accounting = merged;
    if (data.data?.status === 2) terminal = true;
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (signal?.aborted) { finish("aborted"); controller.error(signal.reason); return; }
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) inspect(line);
        if (done) {
          if (buffer) inspect(buffer);
          finish(terminal ? "completed" : "incomplete");
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        finish(signal?.aborted ? "aborted" : "error");
        await reader.cancel(error).catch(() => {});
        controller.error(error);
      }
    },
    async cancel(reason) { finish("aborted"); await reader.cancel(reason); },
  }, { highWaterMark: 0 });
  return { success: true, response: new Response(body, { headers: { "Content-Type": res.headers.get("content-type") || "text/event-stream", "Access-Control-Allow-Origin": "*" } }), accountingCompletion };
}

// MiniMax T2A HTTP returns hex audio synchronously and SSE when stream=true.
export default async function minimaxTts({ baseUrl, apiKey, text, modelId, voiceId, proxyOptions, ...options }) {
  const { language, model: _model, input: _input, voice, response_format, responseFormat: _responseFormat, speed, signal, ...requested } = options;
  const voiceSetting = { voice_id: voice || voiceId || "English_expressive_narrator", speed: speed ?? 1, vol: 1, pitch: 0, ...(requested.voice_setting || {}) };
  const audioSetting = { sample_rate: 32000, bitrate: 128000, format: response_format || "mp3", channel: 1, ...(requested.audio_setting || {}) };
  const body = {
    model: modelId || "speech-2.8-hd", text, stream: false, language_boost: language || "auto", output_format: "hex",
    ...requested, voice_setting: voiceSetting, audio_setting: audioSetting,
  };
  const res = await proxyAwareFetch(baseUrl, {
    method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, body: JSON.stringify(body), signal,
  }, proxyOptions);
  if (body.stream) {
    if (!res.ok) throw new Error(await res.text() || `MiniMax TTS error (${res.status})`);
    return streamingResult(res, signal);
  }
  const rawText = await res.text();
  let data = {};
  if (rawText) try {data = JSON.parse(rawText);} catch {}
  const baseResp = data.base_resp || data.baseResp || {};
  const statusCode = Number(baseResp.status_code ?? baseResp.statusCode ?? 0);
  const statusMessage = baseResp.status_msg || baseResp.statusMsg || data.message || "";
  if (!res.ok) throw new Error(statusMessage || rawText || `MiniMax TTS error (${res.status})`);
  if (statusCode !== 0) throw new Error(statusMessage || "MiniMax TTS upstream error");
  const accounting = accountingFrom(data);
  return { base64: hexToBase64(data.data?.audio), format: data.extra_info?.audio_format || data.extraInfo?.audioFormat || audioSetting.format, accounting };
}