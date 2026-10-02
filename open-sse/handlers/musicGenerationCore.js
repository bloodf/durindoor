import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../services/oauthCredentialManager.js";
import { isString } from "../../src/shared/utils/typeChecks.js";


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

function normalizeMusicResponse(provider, model, parsed) {
  if (parsed?.object === "music.generation") return parsed;
  const data = Array.isArray(parsed?.data)
    ? parsed.data
    : Array.isArray(parsed?.clips)
      ? parsed.clips
      : Array.isArray(parsed?.songs)
        ? parsed.songs
        : parsed
          ? [parsed]
          : [];
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
      raw: item,
    })),
    raw: parsed,
  };
}

async function handleMinimaxMusicGeneration({ provider, model, body, credentials }) {
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
  try { response = await proxyAwareFetch(config.baseUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(payload) }, resolveCredentialProxyOptions(credentials)); } catch (err) { return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${provider} music request failed: ${err?.message || err}`); }
  const text = await response.text().catch(() => "");
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { body: text }; }
  const statusCode = Number(parsed?.base_resp?.status_code);
  if (!response.ok || statusCode && statusCode !== 0) return createErrorResult(response.ok ? HTTP_STATUS.BAD_GATEWAY : response.status, parsed?.base_resp?.status_msg || parsed?.message || text || `${provider} returned HTTP ${response.status}`);
  const audio = parsed?.data?.audio;
  const audioUrl = isString(audio) && /^https?:\/\//i.test(audio) ? audio : null;
  const hexAudio = isString(audio) && /^(?:[0-9a-f]{2})+$/i.test(audio);
  const b64Json = hexAudio ? Buffer.from(audio, "hex").toString("base64") : isString(audio) && /^data:audio\/[^;]+;base64,/i.test(audio) ? audio.split(",", 2)[1] : null;
  const normalized = { object: "music.generation", provider, model, status: "submitted", data: [{ id: parsed?.task_id || parsed?.data?.audio_id || null, audio_url: audioUrl, ...(b64Json ? { b64_json: b64Json } : null), raw: parsed }], raw: parsed };
  return { success: true, response: new Response(JSON.stringify(normalized), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
}

export async function handleMusicGenerationCore({ provider, model, body, credentials }) {
  if (provider === "minimax" || provider === "minimax-cn") return handleMinimaxMusicGeneration({ provider, model, body, credentials });
  const config = MUSIC_PROVIDERS[provider];
  if (!config) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support music generation`);
  if (!body?.prompt) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  const cookie = cookieHeader(credentials);
  if (!cookie) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, `${provider} requires a session cookie`);

  const payload = {
    prompt: body.prompt,
    model,
    make_instrumental: body.make_instrumental ?? body.instrumental ?? false,
    title: body.title,
    tags: body.tags,
    lyrics: body.lyrics,
    duration: body.duration,
  };

  let response;
  try {
    response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
        Origin: new URL(config.referer).origin,
        Referer: config.referer,
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      },
      body: JSON.stringify(payload),
    });
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
  return {
    success: true,
    response: new Response(JSON.stringify(normalizeMusicResponse(provider, model, parsed)), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}
