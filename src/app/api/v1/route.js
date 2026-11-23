import { corsHeaders } from "@/lib/http/cors.js";
export { GET } from "./models/route";
export function OPTIONS() {
  return new Response(null, { headers: corsHeaders(["GET", "OPTIONS"]) });
}
