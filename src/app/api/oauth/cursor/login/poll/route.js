import { isString } from "../../../../../../shared/utils/typeChecks.js";
import { cursorTokenDetails, pollCursorLoginSession } from "@/lib/oauth/services/cursorLogin.js";
import { createProviderConnection, getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { isNonAdminApiKeyCaller } from "@/dashboardGuard";

export async function POST(request) {
  if (await isNonAdminApiKeyCaller(request)) return Response.json({ error: "Admin access required" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!isString(body?.sessionId) || !body.sessionId.trim()) return Response.json({ error: "sessionId is required" }, { status: 400 });
  const result = await pollCursorLoginSession(body.sessionId.trim());
  if (result.status === "pending") return Response.json(result);
  if (result.status === "expired") return Response.json(result, { status: 410 });
  if (result.status !== "ok") return Response.json({ status: "error", error: "Cursor login poll failed" }, { status: result.httpStatus >= 400 && result.httpStatus <= 599 ? result.httpStatus : 502 });
  try {
    const details = cursorTokenDetails(result.accessToken);
    const machineId = await getConsistentMachineId();
    const existing = details.accountId && (await getProviderConnections({ provider: "cursor" })).find((c) => c.authType === "oauth" && (c.providerSpecificData?.accountId || c.providerSpecificData?.userId) === details.accountId);
    const providerSpecificData = { ...existing?.providerSpecificData, machineId, authMethod: "deep_control", provider: "Deep Control", accountId: details.accountId, userId: details.accountId };
    const values = { accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: details.expiresAt, email: details.email, providerSpecificData, testStatus: "active" };
    const connection = existing ? await updateProviderConnection(existing.id, values) : await createProviderConnection({ provider: "cursor", authType: "oauth", ...values }, { createOnly: true });
    return Response.json({ status: "ok", success: true, connection: { id: connection.id, provider: "cursor", email: connection.email || details.email } });
  } catch {
    return Response.json({ status: "error", error: "Failed to save Cursor connection" }, { status: 500 });
  }
}
