import { getProviderConnectionById, updateProviderConnection } from "@/models";
import { canAccessManagementApi, isOperatorRequest, hasExactRequestOrigin } from "@/dashboardGuard";
import { isIsolatedLoginRequest } from "@/lib/webLoginSession";
import { refreshProfile } from "./profile.js";

export const dynamic = "force-dynamic";

/** Refresh a supported OAuth profile without returning credentials. */
export async function POST(request, { params }) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (isIsolatedLoginRequest(request) || !(await canAccessManagementApi(request)) || !(await isOperatorRequest(request))) return json({ error: "Operator access required" }, 403);
  if (request.headers.get("origin") && !hasExactRequestOrigin(request)) return json({ error: "Cross-origin request denied" }, 403);
  const { id } = await params;
  const connection = await getProviderConnectionById(id);
  if (!connection) return json({ error: "Connection not found" }, 404);
  try {
    const patch = await refreshProfile(connection);
    if (!await updateProviderConnection(id, patch)) return json({ error: "Profile update failed" }, 500);
    return json({ success: true });
  } catch {
    return json({ error: "Could not refresh profile" }, 400);
  }
}
