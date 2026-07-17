import { handleVideoGeneration } from "@/sse/handlers/video.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/video/generations - OpenAI-style video generation endpoint */
export async function POST(request) {
  return await handleVideoGeneration(request);
}
