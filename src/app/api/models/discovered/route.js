import { NextResponse } from "next/server";
import { isString, isBoolean } from "@/shared/utils/typeChecks.js";
import { addDiscoveredModelAliases } from "@/lib/db/repos/aliasRepo.js";

// Commit the selection atomically so a retry cannot duplicate or replace aliases.
export async function POST(request) {
  try {
    const { providerAlias, ids, passthrough } = await request.json();
    if (!isString(providerAlias) || !/^[\w.-]{1,128}$/.test(providerAlias) ||
        !Array.isArray(ids) || ids.length < 1 || ids.length > 1000 ||
        ids.some((id) => !isString(id) || !id.trim() || id !== id.trim() || id.length > 512) ||
        (passthrough !== undefined && !isBoolean(passthrough))) {
      return NextResponse.json({ error: "Invalid model selection" }, { status: 400 });
    }
    const added = await addDiscoveredModelAliases(providerAlias, ids, passthrough);
    return NextResponse.json({ added });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    console.error("Failed to add discovered models", error);
    return NextResponse.json({ error: "Failed to add selected models" }, { status: 500 });
  }
}
