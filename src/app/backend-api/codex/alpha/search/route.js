import { corsHeaders } from "@/lib/http/cors.js";
export { POST } from "@/app/api/v1/alpha/search/route.js";

export function OPTIONS() {
  return new Response(null, { headers: corsHeaders(["POST", "OPTIONS"]) });
}
