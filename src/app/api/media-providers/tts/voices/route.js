import { listTtsVoices } from "@/lib/ttsVoices.js";
import { NextResponse } from "next/server";

/**
 * GET /api/media-providers/tts/voices
 * Query:
 *   ?provider=edge-tts | local-device | elevenlabs  (default: edge-tts)
 *   ?lang=en     (optional filter by lang code)
 *   ?apiKey=xxx  (required for elevenlabs)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider   = searchParams.get("provider") || "edge-tts";
    const langFilter = searchParams.get("lang");
    const apiKey     = searchParams.get("apiKey");

    const data = await listTtsVoices(provider, langFilter, apiKey);
    if (!data) {
      return NextResponse.json({ error: `Provider '${provider}' does not support voice listing` }, { status: 400 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to fetch voices" }, { status: 502 });
  }
}
