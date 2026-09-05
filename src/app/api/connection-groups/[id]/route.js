import { NextResponse } from "next/server";
import {
  deleteConnectionGroup,
  getConnectionGroupById,
  updateConnectionGroup,
  ConnectionGroupNotFoundError,
  ConnectionGroupValidationError,
} from "@/lib/localDb";
import { isObject } from "../../../../shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

async function readBody(request) {
  const length = request.headers.get("content-length");
  if (/^\d+$/.test(length || "") && Number(length) > MAX_BODY_BYTES) {
    return { error: "Request body exceeds 64 KiB" };
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
        return { error: "Request body exceeds 64 KiB" };
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
    return group ? NextResponse.json(group) : NextResponse.json({ error: "Connection group not found" }, { status: 404 });
  } catch (error) {
    console.log("Error fetching connection group:", error);
    return NextResponse.json({ error: "Failed to fetch connection group" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const parsed = await readBody(request);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    return NextResponse.json(await updateConnectionGroup((await params).id, parsed.body));
  } catch (error) {
    if (error instanceof ConnectionGroupNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ConnectionGroupValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.log("Error updating connection group:", error);
    return NextResponse.json({ error: "Failed to update connection group" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const deleted = await deleteConnectionGroup((await params).id);
    return deleted ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Connection group not found" }, { status: 404 });
  } catch (error) {
    console.log("Error deleting connection group:", error);
    return NextResponse.json({ error: "Failed to delete connection group" }, { status: 500 });
  }
}
