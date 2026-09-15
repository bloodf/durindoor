import { NextResponse } from "next/server";
import { createApiKeyGroup, getApiKeyGroups } from "@/lib/db/repos/apiKeyGroupsRepo.js";
import { isObject } from "../../../shared/utils/typeChecks.js";

// API-key groups are organizational labels only: nothing here widens or narrows
// what a key may do. Access stays governed by the key's policy, allowedCombos,
// and apiKeyProviderConnections rows.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ groups: await getApiKeyGroups() });
  } catch (error) {
    console.log("Error fetching key groups:", error);
    return NextResponse.json({ error: "Failed to fetch key groups" }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || !isObject(body) || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return NextResponse.json({ group: await createApiKeyGroup(body) }, { status: 201 });
  } catch (error) {
    // A duplicate name is the operator's mistake, not a server fault.
    const duplicate = /UNIQUE|duplicate/i.test(error?.message || "");
    if (duplicate) {
      return NextResponse.json({ error: "A group with that name already exists" }, { status: 409 });
    }
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.log("Error creating key group:", error);
    return NextResponse.json({ error: "Failed to create key group" }, { status: 500 });
  }
}
