import { handleMusicGeneration } from "@/sse/handlers/music.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/music/generations - OpenAI-style music generation endpoint */
export async function POST(request) {
  return await handleMusicGeneration(request);
}
