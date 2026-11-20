import { NextResponse } from "next/server";
import { readableProviderConnections } from "@/lib/mediaProviderConnections.js";
import { fetchElevenLabsModels } from "open-sse/handlers/ttsCore.js";
import { TTS_MODELS_CONFIG } from "open-sse/config/ttsModels.js";

export async function GET(request) {
  const fallback = { models: TTS_MODELS_CONFIG.elevenlabs.models, source: "static" };
  try {
    const connections = await readableProviderConnections(request, "elevenlabs");
    const apiKey = connections[0]?.apiKey;
    if (!apiKey) return NextResponse.json(fallback);
    const models = await fetchElevenLabsModels(apiKey);
    return NextResponse.json(models.length ? { models, source: "live" } : fallback);
  } catch {
    return NextResponse.json(fallback);
  }
}
