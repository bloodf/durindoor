import { createCursorLoginSession } from "@/lib/oauth/services/cursorLogin.js";
import { isNonAdminApiKeyCaller } from "@/dashboardGuard";

export async function POST(request) {
  if (await isNonAdminApiKeyCaller(request)) return Response.json({ error: "Admin access required" }, { status: 403 });
  return Response.json({ success: true, ...createCursorLoginSession() });
}
