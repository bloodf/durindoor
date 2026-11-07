import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { UPDATER_CONFIG } from "@/shared/constants/config";

// The internal list call targets this server, never an origin taken from the request.
const serverOrigin = () => `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
const FORWARDED_CREDENTIALS = ["authorization", "x-api-key", "x-goog-api-key", "x-9r-cli-token"];

// Forward the caller's credentials as sent so the internal route applies the same key scope.
function credentialHeaders(request) {
  const headers = new Headers();
  for (const name of FORWARDED_CREDENTIALS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

// Provider → internal voices API. Edge/local-device share the generic endpoint.
const PROVIDER_API = {
  elevenlabs: (origin) => `${origin}/api/media-providers/tts/elevenlabs/voices`,
  deepgram: (origin) => `${origin}/api/media-providers/tts/deepgram/voices`,
  inworld: (origin) => `${origin}/api/media-providers/tts/inworld/voices`,
  minimax: (origin) => `${origin}/api/media-providers/tts/minimax/voices`,
  "minimax-cn": (origin) => `${origin}/api/media-providers/tts/minimax/voices?provider=minimax-cn`,
  "edge-tts": (origin) => `${origin}/api/media-providers/tts/voices?provider=edge-tts`,
  "local-device": (origin) => `${origin}/api/media-providers/tts/voices?provider=local-device`,
};

async function OPTIONSHandler() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

// GET /v1/audio/voices?provider={p}[&lang=xx]
// Returns OpenAI-style list with each voice's full model id ready for /v1/audio/speech
async function GETHandler(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const lang = searchParams.get("lang");

    if (!provider || !PROVIDER_API[provider]) {
      return Response.json(
        { error: { message: `provider must be one of: ${Object.keys(PROVIDER_API).join(", ")}`, type: "invalid_request_error" } },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const baseUrl = PROVIDER_API[provider](serverOrigin());
    const url = new URL(baseUrl);
    if (lang) url.searchParams.set("lang", lang);
    if (searchParams.get("key")) url.searchParams.set("key", searchParams.get("key"));
    const res = await fetch(url, { cache: "no-store", headers: credentialHeaders(request) });
    const data = await res.json();
    if (!res.ok || data.error) {
      return Response.json(
        { error: { message: data.error || `Upstream ${res.status}`, type: "server_error" } },
        { status: res.status, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    // Internal API shape: { voices } when lang filter, else { byLang, languages }
    const rawVoices = lang
      ? (data.voices || [])
      : Object.values(data.byLang || {}).flatMap((l) => l.voices || []);

    // Use provider alias for /v1/audio/speech model param (matches skill convention e.g. el/, dg/, edge-tts/)
    const alias = AI_PROVIDERS[provider]?.alias || provider;
    const data_out = rawVoices.map((v) => ({
      id: v.id,
      name: v.name,
      lang: v.lang || "",
      gender: v.gender || "",
      model: `${alias}/${v.id}`,
    }));

    return Response.json({ object: "list", data: data_out }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return Response.json(
      { error: { message: err.message || "Failed", type: "server_error" } },
      { status: 502, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const GET = withHttpRequestCorrelation(GETHandler);
