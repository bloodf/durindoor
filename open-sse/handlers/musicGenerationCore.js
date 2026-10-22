import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { isNumber, isString } from "../../src/shared/utils/typeChecks.js";
import { mediaAccounting } from "./mediaAccounting.js";
import { extractCompleteSseFrames } from "../utils/streamHelpers.js";


const MUSIC_PROVIDERS = {
  suno: {
    baseUrl: "https://studio-api.suno.ai/api/generate/v2/",
    referer: "https://suno.ai/",
  },
  udio: {
    baseUrl: "https://www.udio.com/api/generate-proxy",
    referer: "https://www.udio.com/",
  },
};

function cookieHeader(credentials) {
  const raw = credentials?.apiKey || credentials?.accessToken || "";
  if (!raw) return "";
  return String(raw).replace(/^cookie:\s*/i, "").replace(/^Cookie:\s*/i, "").trim();
}

function musicItems(parsed) {
  return [parsed, parsed?.data, parsed?.clips, parsed?.songs].find(Array.isArray) || [];
}

function normalizeMusicResponse(provider, model, parsed) {
  const data = musicItems(parsed);
  return {
    object: "music.generation",
    provider,
    model,
    status: parsed?.status || "submitted",
    data: data.map((item) => ({
      id: item.id || item.clip_id || item.audio_id || null,
      title: item.title || item.name || null,
      audio_url: item.audio_url || item.audioUrl || item.url || item.song_path || null,
      image_url: item.image_url || item.imageUrl || item.image_path || null,
      status: item.status ?? (item.finished === true ? "complete" : "submitted"),
      raw: item,
    })),
    raw: parsed,
  };
}

// Provider contracts: MiniMax data.status=2 completes music; Suno URLs can be
// playable while status=streaming; Udio track_ids are submissions, not songs.
// https://platform.minimax.io/docs/api-reference/music-generation
// https://github.com/gcui-art/suno-api/blob/main/src/lib/SunoApi.ts
// https://github.com/flowese/UdioWrapper/blob/main/udio_wrapper/__init__.py
function musicAccounting(parsed, provider) {
  const accounting = mediaAccounting(parsed, provider, "music");
  const duration = parsed?.extra_info?.music_duration;
  if (["minimax", "minimax-cn"].includes(provider) && isNumber(duration) && Number.isFinite(duration) && duration >= 0) {
    accounting.nativeUnits.audioSeconds = duration / 1000;
    accounting.meta.nativeUnitsSource = "extra_info.music_duration (milliseconds)";
  }
  return accounting;
}

function webMusicResult(provider, model, parsed, resourceId = null) {
  const items = musicItems(parsed);
  const ids = resourceId ? resourceId.split(",") : provider === "udio" ? parsed?.track_ids : items.map((item) => item?.id);
  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => isString(id) && /^[\w-]+$/.test(id)) || new Set(ids).size !== ids.length) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Music provider did not return valid job identities");
  }
  const normalized = normalizeMusicResponse(provider, model, parsed);
  const matching = ids.map((id) => items.find((item) => item?.id === id));
  if (resourceId && (items.length !== ids.length || matching.some((item) => !item))) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Music provider returned different job identities");
  }
  const failed = Boolean(parsed?.error) || matching.some((item) => item?.error || item?.status === "error" || item?.status === "failed");
  const complete = matching.every((item) => item && (provider === "suno" ? item.status === "complete" : item.finished === true) && (item.audio_url || item.song_path));
  normalized.status = failed ? "failed" : complete ? "completed" : "submitted";
  normalized.request_id = ids.slice().sort().join(",");
  const accounting = musicAccounting(parsed, provider);
  accounting.state = failed ? "failed" : complete ? "complete" : "pending";
  if (complete && provider === "suno" && matching.every((item) => isNumber(item.metadata?.duration) && Number.isFinite(item.metadata.duration) && item.metadata.duration >= 0)) {
    accounting.nativeUnits.audioSeconds = matching.reduce((sum, item) => sum + item.metadata.duration, 0);
    accounting.meta.nativeUnitsSource = "clips[].metadata.duration (seconds)";
  }
  return {
    success: true, accounting,
    job: { resourceId: normalized.request_id, terminal: failed ? "failed" : complete ? "succeeded" : null },
    response: new Response(JSON.stringify(normalized), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }),
  };
}

function musicStreamResult(response, provider, onComplete) {
  const accounting = musicAccounting(null, provider);
  accounting.state = "pending";
  const sse = /text\/event-stream/i.test(response.headers.get("content-type") || "");
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = null;
  let failed = false;
  let bytes = 0;
  const consume = (text) => {
    buffer += text;
    const { frames, remainder } = extractCompleteSseFrames(buffer);
    buffer = remainder;
    for (const frame of frames) {
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") continue;
      const value = JSON.parse(data);
      if (value.error || (value.base_resp?.status_code !== undefined && value.base_resp.status_code !== 0)) failed = true;
      if (value.data?.status === 2) terminal = value;
    }
  };
  const stream = new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (sse) consume(decoder.decode(chunk, { stream: true }));
      controller.enqueue(chunk);
    },
    async flush() {
      if (sse) consume(decoder.decode());
      // EOF alone is not a successful SSE terminal. Binary bytes pass untouched;
      // a failed/cancelled transport never reaches flush and never records usage.
      if (failed || (sse ? !terminal || buffer.trim() !== "" : bytes === 0)) return;
      Object.assign(accounting, musicAccounting(terminal, provider), { state: "complete" });
      await onComplete?.(accounting);
    },
  });
  return { success: true, deferred: true, accounting, response: new Response(response.body.pipeThrough(stream), { status: response.status, headers: response.headers }) };
}

async function handleMinimaxMusicGeneration({ provider, model, body, credentials, signal, onComplete }) {
  const config = PROVIDER_MEDIA[provider]?.musicConfig;
  if (!config?.baseUrl) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support music generation`);
  const instrumental = body.is_instrumental ?? body.instrumental ?? false;
  if (model === "music-cover") {
    if (!body.prompt) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "music-cover requires a prompt");
    if (["audio_url", "audio_base64", "cover_feature_id"].filter((field) => body[field]).length !== 1) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "music-cover requires exactly one of audio_url, audio_base64, or cover_feature_id");
  } else if (instrumental ? !body.prompt : !body.prompt && !body.lyrics) return createErrorResult(HTTP_STATUS.BAD_REQUEST, instrumental ? "Instrumental music requires a prompt" : "Music requires prompt or lyrics");
  const payload = { model };
  for (const field of ["prompt", "lyrics", "stream", "output_format", "audio_setting", "audio_url", "audio_base64", "cover_feature_id", "is_instrumental", "lyrics_optimizer", "aigc_watermark"]) if (body[field] !== undefined) payload[field] = body[field];
  if (payload.is_instrumental === undefined) payload.is_instrumental = instrumental;
  const key = credentials?.apiKey || credentials?.accessToken;
  if (!key) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, `${provider} requires an API key`);
  let response;
  try { response = await proxyAwareFetch(config.baseUrl, { method: "POST", signal, headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(payload) }, resolveCredentialProxyOptions(credentials)); } catch (err) { return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${provider} music request failed: ${err?.message || err}`); }
  if (response.ok && response.body && /^(?:audio\/|application\/octet-stream|text\/event-stream)/i.test(response.headers.get("content-type") || "")) return musicStreamResult(response, provider, onComplete);
  const text = await response.text().catch(() => "");
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { body: text }; }
  const statusCode = Number(parsed?.base_resp?.status_code);
  if (!response.ok || statusCode && statusCode !== 0) return createErrorResult(response.ok ? HTTP_STATUS.BAD_GATEWAY : response.status, parsed?.base_resp?.status_msg || parsed?.message || text || `${provider} returned HTTP ${response.status}`);
  const audio = parsed?.data?.audio;
  const audioUrl = isString(audio) && /^https?:\/\//i.test(audio) ? audio : null;
  const hexAudio = isString(audio) && /^(?:[0-9a-f]{2})+$/i.test(audio);
  const b64Json = hexAudio ? Buffer.from(audio, "hex").toString("base64") : isString(audio) && /^data:audio\/[^;]+;base64,/i.test(audio) ? audio.split(",", 2)[1] : null;
  const completed = parsed?.data?.status === 2 && Boolean(audioUrl || b64Json);
  const item = { id: parsed?.task_id || parsed?.data?.audio_id || null, audio_url: audioUrl };
  if (b64Json) item.b64_json = b64Json;
  item.raw = parsed;
  const normalized = { object: "music.generation", provider, model, status: completed ? "completed" : "submitted", data: [item], raw: parsed };
  const accounting = musicAccounting(parsed, provider);
  accounting.state = completed ? "complete" : "pending";
  return { success: true, accounting, response: new Response(JSON.stringify(normalized), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
}

export async function handleMusicGenerationCore({ provider, model, body, credentials, requestId = null, signal, onComplete }) {
  if (provider === "minimax" || provider === "minimax-cn") return handleMinimaxMusicGeneration({ provider, model, body, credentials, signal, onComplete });
  const config = MUSIC_PROVIDERS[provider];
  if (!config) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support music generation`);
  if (!requestId && !body?.prompt) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  if (requestId && !/^[\w-]+(?:,[\w-]+)*$/.test(requestId)) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Invalid music request id");
  const cookie = cookieHeader(credentials);
  if (!cookie) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, `${provider} requires a session cookie`);

  const payload = requestId ? null : {
    prompt: body.prompt,
    model,
    make_instrumental: body.make_instrumental ?? body.instrumental ?? false,
    title: body.title,
    tags: body.tags,
    lyrics: body.lyrics,
    duration: body.duration,
  };
  const url = requestId ? new URL(provider === "suno" ? "/api/feed/v2" : "/api/songs", config.baseUrl) : new URL(config.baseUrl);
  if (requestId) url.searchParams.set(provider === "suno" ? "ids" : "songIds", requestId);

  let response;
  try {
    const options = {
      method: requestId ? "GET" : "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
        Origin: new URL(config.referer).origin,
        Referer: config.referer,
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      },
    };
    if (payload) options.body = JSON.stringify(payload);
    response = await proxyAwareFetch(url.toString(), options, resolveCredentialProxyOptions(credentials));
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${provider} music request failed: ${err?.message || err}`);
  }

  const text = await response.text().catch(() => "");
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { body: text };
  }
  if (!response.ok) {
    const message = parsed?.error?.message || parsed?.message || text || `${provider} returned HTTP ${response.status}`;
    return createErrorResult(response.status, message);
  }
  return webMusicResult(provider, model, parsed, requestId);
}
