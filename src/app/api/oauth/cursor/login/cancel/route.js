import { isString } from "../../../../../../shared/utils/typeChecks.js";
import { cancelCursorLoginSession } from "@/lib/oauth/services/cursorLogin.js";
import { isNonAdminApiKeyCaller } from "@/dashboardGuard";

export async function POST(request) {
  if (await isNonAdminApiKeyCaller(request)) return Response.json({ error: "Admin access required" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!isString(body?.sessionId) || !body.sessionId.trim()) return Response.json({ error: "sessionId is required" }, { status: 400 });
  return Response.json({ success: true, cancelled: cancelCursorLoginSession(body.sessionId.trim()) });
}
