import { NextResponse } from "next/server";
import {
  addConnectionToGroup,
  getConnectionGroupById,
  removeConnectionFromGroup,
  ConnectionGroupNotFoundError,
  ConnectionGroupValidationError,
} from "@/lib/localDb";
import { isObject, isString } from "../../../../../shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

async function readBody(request) {
  const length = request.headers.get("content-length");
  if (/^\d+$/.test(length || "") && Number(length) > MAX_BODY_BYTES) {
    return { error: "Request body exceeds 8 KiB" };
  }
  if (!request.body) return { error: "Invalid JSON body" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return { error: "Request body exceeds 8 KiB" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    if (!body || !isObject(body) || Array.isArray(body)) return { error: "Invalid JSON body" };
    return { body };
  } catch {
    return { error: "Invalid JSON body" };
  } finally {
    reader.releaseLock();
  }
}

export async function GET(request, { params }) {
  try {
    const group = await getConnectionGroupById((await params).id);
    return group
      ? NextResponse.json({ connectionIds: group.connectionIds })
      : NextResponse.json({ error: "Connection group not found" }, { status: 404 });
  } catch (error) {
    console.log("Error fetching group members:", error);
    return NextResponse.json({ error: "Failed to fetch group members" }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const parsed = await readBody(request);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!isString(parsed.body.connectionId) || parsed.body.connectionId.length === 0) {
    return NextResponse.json({ error: "connectionId must be a non-empty string" }, { status: 400 });
  }
  try {
    await addConnectionToGroup((await params).id, parsed.body.connectionId);
    const updated = await getConnectionGroupById((await params).id);
    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    if (error instanceof ConnectionGroupNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ConnectionGroupValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.log("Error adding connection to group:", error);
    return NextResponse.json({ error: "Failed to add connection to group" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const parsed = await readBody(request);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!isString(parsed.body.connectionId) || parsed.body.connectionId.length === 0) {
    return NextResponse.json({ error: "connectionId must be a non-empty string" }, { status: 400 });
  }
  try {
    await removeConnectionFromGroup((await params).id, parsed.body.connectionId);
    return NextResponse.json({ removed: true }, { status: 200 });
  } catch (error) {
    if (error instanceof ConnectionGroupNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ConnectionGroupValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.log("Error removing connection from group:", error);
    return NextResponse.json({ error: "Failed to remove connection from group" }, { status: 500 });
  }
}
