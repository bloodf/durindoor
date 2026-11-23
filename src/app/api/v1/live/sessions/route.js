import { corsHeaders } from "@/lib/http/cors.js";
import { handleOpenAINativeSession } from "@/sse/handlers/nativeProvider.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
export const runtime = "nodejs";
async function POSTHandler(request) { return handleOpenAINativeSession(request, "/v1/live/sessions"); }
async function OPTIONSHandler() { return new Response(null, { headers: { ...corsHeaders(["POST", "OPTIONS"]), } }); }
export const POST = withHttpRequestCorrelation(POSTHandler);
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
