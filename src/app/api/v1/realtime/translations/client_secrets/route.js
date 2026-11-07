import { handleOpenAINativeSession } from "@/sse/handlers/nativeProvider.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
export const runtime = "nodejs";
async function POSTHandler(request) { return handleOpenAINativeSession(request, "/v1/realtime/translations/client_secrets"); }
async function OPTIONSHandler() { return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" } }); }
export const POST = withHttpRequestCorrelation(POSTHandler);
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
