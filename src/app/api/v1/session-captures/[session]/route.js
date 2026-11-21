import { resolveClientApiKey } from "@/sse/services/auth.js";
import { withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { deleteSessionTurns, normalizeCaptureSessionId, readSessionTurns } from "@/lib/db/repos/sessionCaptureRepo.js";

const headers = { "Cache-Control": "no-store" };

function failure(status, message) {
  return Response.json({ error: { message } }, { status, headers });
}

async function sessionCapture(request, { params }, remove) {
  try {
    const { apiKey: credential, auth } = await resolveClientApiKey(request, { required: true });
    if (!auth.ok || !auth.stored || !auth.apiKeyId || !credential) return failure(401, "Authentication required");
    const session = normalizeCaptureSessionId((await params).session);
    if (!session) return failure(400, "Invalid session ID");

    const options = { credential, session, expectedKeyId: auth.apiKeyId };
    if (remove) {
      await deleteSessionTurns(options);
      return new Response(null, { status: 204, headers });
    }

    const limits = new URL(request.url).searchParams.getAll("limit");
    if (limits.length > 1 || (limits.length && !/^(?:[1-9][0-9]?|100)$/.test(limits[0]))) {
      return failure(400, "Invalid limit");
    }
    const turns = await readSessionTurns({ ...options, limit: limits.length ? Number(limits[0]) : undefined });
    return Response.json({ turns }, { headers });
  } catch (error) {
    if (error?.message === "Authentication required") return failure(401, "Authentication required");
    return failure(503, "Capture storage unavailable");
  }
}

export const GET = withHttpRequestCorrelation((request, context) => sessionCapture(request, context, false));
export const DELETE = withHttpRequestCorrelation((request, context) => sessionCapture(request, context, true));
