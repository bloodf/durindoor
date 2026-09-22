import { NextResponse } from "next/server";
import { getEnabledModels, setEnabledModels } from "@/lib/enabledModelsDb";
import { isString } from "@/shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

// GET /api/models/enabled?providerAlias=xxx
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawAlias = searchParams.get("providerAlias");
    const all = await getEnabledModels();
    if (rawAlias !== null) {
      const providerAlias = rawAlias.trim();
      if (!providerAlias) return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
      return NextResponse.json({ ids: all[providerAlias] || [] });
    }
    return NextResponse.json({ enabled: all });
  } catch (error) {
    console.log("Error fetching enabled models:", error);
    return NextResponse.json({ error: "Failed to fetch enabled models" }, { status: 500 });
  }
}

// PUT /api/models/enabled  body: { providerAlias, ids: [...] }
// Replaces the allowlist for one provider alias; an empty ids[] clears it,
// which means "no restriction, every model the provider exposes is visible".
export async function PUT(request) {
  try {
    const { providerAlias: rawAlias, ids } = await request.json();
    const providerAlias = isString(rawAlias) ? rawAlias.trim() : "";
    if (!providerAlias || !Array.isArray(ids)) {
      return NextResponse.json({ error: "providerAlias and ids[] required" }, { status: 400 });
    }

    const cleaned = ids.filter((id) => isString(id) && id.trim() !== "").map((id) => id.trim());

    // setEnabledModels also drops these ids from the disabled-model blacklist
    // (which /v1/models applies on top of the allowlist), in one transaction.
    await setEnabledModels(providerAlias, cleaned);

    return NextResponse.json({ success: true, ids: cleaned });
  } catch (error) {
    console.log("Error setting enabled models:", error);
    return NextResponse.json({ error: "Failed to set enabled models" }, { status: 500 });
  }
}

// DELETE /api/models/enabled?providerAlias=xxx
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = (searchParams.get("providerAlias") ?? "").trim();
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }
    await setEnabledModels(providerAlias, []);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error clearing enabled models:", error);
    return NextResponse.json({ error: "Failed to clear enabled models" }, { status: 500 });
  }
}
