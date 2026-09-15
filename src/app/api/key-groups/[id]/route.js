import { NextResponse } from "next/server";
import {
  deleteApiKeyGroup,
  getApiKeyGroupById,
  updateApiKeyGroup,
} from "@/lib/db/repos/apiKeyGroupsRepo.js";
import { isObject } from "../../../../shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const group = await getApiKeyGroupById(id);
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    return NextResponse.json({ group });
  } catch (error) {
    console.log("Error fetching key group:", error);
    return NextResponse.json({ error: "Failed to fetch key group" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
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
    const { id } = await params;
    const group = await updateApiKeyGroup(id, body);
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    return NextResponse.json({ group });
  } catch (error) {
    if (/UNIQUE|duplicate/i.test(error?.message || "")) {
      return NextResponse.json({ error: "A group with that name already exists" }, { status: 409 });
    }
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.log("Error updating key group:", error);
    return NextResponse.json({ error: "Failed to update key group" }, { status: 500 });
  }
}

// Deleting a group removes the label and its membership rows. Every API key
// survives: a credential must never disappear because its grouping did.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const removed = await deleteApiKeyGroup(id);
    if (!removed) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting key group:", error);
    return NextResponse.json({ error: "Failed to delete key group" }, { status: 500 });
  }
}
