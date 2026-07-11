import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { DATABASE_IMPORT_MAX_BYTES } from "@/shared/constants/quota";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

class DatabaseImportTooLargeError extends Error {
  constructor() {
    super("Database import exceeds the byte safety limit");
    this.name = "DatabaseImportTooLargeError";
    this.code = "DATABASE_IMPORT_TOO_LARGE";
  }
}

/** Read JSON incrementally so chunked requests cannot bypass Content-Length. */
export async function readJsonBodyWithLimit(request, maxBytes = DATABASE_IMPORT_MAX_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Database import byte limit is invalid");
  const contentLength = request.headers.get("content-length");
  if (/^\d+$/.test(contentLength || "") && Number(contentLength) > maxBytes) {
    throw new DatabaseImportTooLargeError();
  }
  if (!request.body) throw new Error("Database import body is required");

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new DatabaseImportTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text);
}

export async function GET(request) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const payload = await exportDb();
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { password, ...payload } = await readJsonBodyWithLimit(request);
    if (!isCliRequest(request) && !(await verifyDashboardPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    await importDb(payload);

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    const tooLarge = error?.code === "DATABASE_IMPORT_TOO_LARGE";
    return NextResponse.json(
      { error: tooLarge ? "Database import is too large" : (error?.message || "Failed to import database") },
      { status: tooLarge ? 413 : 400 }
    );
  }
}
