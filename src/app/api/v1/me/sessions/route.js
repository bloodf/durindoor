import { corsHeaders } from "@/lib/http/cors.js";
import { resolveClientApiKey } from "@/sse/services/auth.js";
import { listKeyUsageSessions } from "@/lib/db/repos/usageRepo.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { auth } = await resolveClientApiKey(request, { required: true });
  if (!auth.ok || !auth.stored || !auth.apiKeyId) {
    return Response.json({ error: "A valid application API key is required." }, { status: 401 });
  }
  const values = new URL(request.url).searchParams.getAll("limit");
  if (values.length > 1 || (values.length && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(values[0]))) {
    return Response.json({ error: "limit must be an integer from 1 to 100." }, { status: 400 });
  }
  return Response.json({ sessions: await listKeyUsageSessions(auth.apiKeyId, values.length ? Number(values[0]) : 50) },
    { headers: { "Cache-Control": "no-store" } });
}

export function OPTIONS() {
  return new Response(null, { headers: corsHeaders(["GET", "OPTIONS"]) });
}
