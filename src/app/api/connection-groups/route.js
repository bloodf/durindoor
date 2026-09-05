import { NextResponse } from "next/server";
import {
  createConnectionGroup,
  getConnectionGroups,
  ConnectionGroupValidationError,
} from "@/lib/localDb";
import { isObject } from "../../../shared/utils/typeChecks.js";

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

export async function GET() {
  try {
    return NextResponse.json({ groups: await getConnectionGroups() });
  } catch (error) {
    console.log("Error fetching connection groups:", error);
    return NextResponse.json({ error: "Failed to fetch connection groups" }, { status: 500 });
  }
}

export async function POST(request) {
  const parsed = await readBody(request);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const group = await createConnectionGroup(parsed.body);
    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    if (error instanceof ConnectionGroupValidationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.log("Error creating connection group:", error);
    return NextResponse.json({ error: "Failed to create connection group" }, { status: 500 });
  }
}
