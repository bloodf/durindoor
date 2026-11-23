import { corsHeaders } from "@/lib/http/cors.js";
import { generateProviderPluginManifest } from "../../../../../open-sse/config/providerPluginManifestRegistry.js";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=60",
};

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      ...corsHeaders(["GET", "OPTIONS"]),
    },
  });
}

export async function GET() {
  return new Response(JSON.stringify(generateProviderPluginManifest()), {
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(["GET", "OPTIONS"]),
    },
  });
}
