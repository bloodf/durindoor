import { isBoolean, isRecord, isString } from "@/shared/utils/typeChecks.js";
// Operator-only connection lifecycle. Profile handles and markers are minted locally;
// imported handles, secrets and paths never become connection configuration.
import { NextResponse } from "next/server";
import { isOperatorRequest } from "@/dashboardGuard";
import { createProviderConnection, updateProviderConnection } from "@/lib/localDb";
import { DATA_DIR } from "@/lib/dataDir.js";
import { initializeProfile, resolveProfile } from "open-sse/services/fireflyWebUi/profile.js";
import { assertNoSuppliedSecrets, parseFireflyWebUiConfig, reject } from "open-sse/services/fireflyWebUi/config.js";

export const FIREFLY_WEB = "adobe-firefly-web";

/** Return editable settings without the private profile reference. */
export function publicFireflyData(data) {
  const { profileHandle: _handle, ...settings } = data?.fireflyWebUi || {};
  return { fireflyWebUi: settings };
}

export function checkFireflySettings(body, existing) {
  assertNoSuppliedSecrets(body);
  if (Object.keys(body).some((key) => !["provider", "name", "isActive", "providerSpecificData"].includes(key))) throw reject(400, "Unsupported Firefly connection field");
  if (body.isActive !== undefined && !isBoolean(body.isActive)) throw reject(400, "isActive must be a boolean");
  const psd = body.providerSpecificData ?? {};
  if (!isRecord(psd) || Object.keys(psd).some((key) => key !== "fireflyWebUi")) throw reject(400, "Only Firefly browser settings are accepted");
  const raw = psd.fireflyWebUi ?? (existing ? publicFireflyData(existing.providerSpecificData).fireflyWebUi : { enabled: false });
  if (!isRecord(raw) || Object.hasOwn(raw, "profileHandle")) throw reject(400, "Private profile references cannot be supplied");
  if (Object.keys(raw).some((key) => !["enabled", "mapping", "modelMap", "limits"].includes(key))) throw reject(400, "Unsupported Firefly browser setting");
  if (raw.enabled !== undefined && !isBoolean(raw.enabled)) throw reject(400, "enabled must be a boolean");
  // A disabled connection may be saved before any mapping exists. Supplied
  // mapping/model values still use the exact bounded generation parser.
  const handle = existing?.providerSpecificData?.fireflyWebUi?.profileHandle;
  const config = { ...raw, enabled: raw.enabled === true, ...(handle ? { profileHandle: handle } : null) };
  const probe = { ...config, enabled: true, profileHandle: handle || "0".repeat(32) };
  parseFireflyWebUiConfig({ providerSpecificData: { fireflyWebUi: probe } }, { purpose: "setup" });
  if (raw.mapping !== undefined || raw.modelMap !== undefined) {
    parseFireflyWebUiConfig({ providerSpecificData: { fireflyWebUi: probe } });
  }
  return config;
}

export async function saveFireflyConnection(request, body, existing = null) {
  if (!(await isOperatorRequest(request))) return NextResponse.json({ error: "Firefly browser settings require a dashboard operator" }, { status: 403 });
  try {
    const config = checkFireflySettings(body, existing);
    const name = body.name ?? existing?.name ?? "Adobe Firefly browser";
    if (!isString(name) || !name.trim() || name.length > 200) throw reject(400, "A bounded connection name is required");
    let connection;
    if (existing) {
      const handle = existing.providerSpecificData?.fireflyWebUi?.profileHandle;
      resolveProfile({ dataDir: DATA_DIR, connectionId: existing.id, profileHandle: handle });
      connection = await updateProviderConnection(existing.id, {
        name: name.trim(), authType: "none", testStatus: "unknown",
        ...(body.isActive !== undefined ? { isActive: body.isActive === true } : null),
        providerSpecificData: { fireflyWebUi: config },
      });
    } else {
      // Always create a disabled row first. A profile allocation failure cannot
      // expose an enabled connection, and name collisions never reuse old rows.
      connection = await createProviderConnection({ provider: FIREFLY_WEB, name: name.trim(), authType: "none", isActive: true, testStatus: "unknown", providerSpecificData: { fireflyWebUi: { ...config, enabled: false } } }, { requireNewName: true, createOnly: true });
      const profile = initializeProfile({ dataDir: DATA_DIR, connectionId: connection.id });
      connection = await updateProviderConnection(connection.id, { providerSpecificData: { fireflyWebUi: { ...config, ...profile } } });
    }
    return NextResponse.json({ connection: { id: connection.id, provider: FIREFLY_WEB, name: connection.name, authType: "none", isActive: connection.isActive, testStatus: "unknown", providerSpecificData: publicFireflyData(connection.providerSpecificData) } }, { status: existing ? 200 : 201 });
  } catch (error) {
    const status = error?.status ?? (error?.code?.startsWith("PROVIDER_CONNECTION_") ? 409 : 500);
    return NextResponse.json({ error: status === 500 ? "Unable to save Firefly browser connection" : error.message }, { status });
  }
}
