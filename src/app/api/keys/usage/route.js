import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import { getApiKeyLimitStatus } from "@/lib/apiKeyLimits.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/usage[?apiKeyId=<id>] - current usage against every windowed
 * limit (RPM, TPM, daily, monthly, budget), keyed by key id. Limits themselves
 * are edited through PUT /api/keys/:id.
 */
export async function GET(request) {
  try {
    const apiKeyId = new URL(request.url).searchParams.get("apiKeyId");
    const keys = (await getApiKeys()).filter((key) => !apiKeyId || key.id === apiKeyId);
    if (apiKeyId && keys.length === 0) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    const statuses = await Promise.all(keys.map((key) => getApiKeyLimitStatus(key)));
    return NextResponse.json({ usage: Object.fromEntries(keys.map((key, i) => [key.id, statuses[i]])) });
  } catch (error) {
    console.log("Error fetching key usage:", error);
    return NextResponse.json({ error: "Failed to fetch key usage" }, { status: 500 });
  }
}
