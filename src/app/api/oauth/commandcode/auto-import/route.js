import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { hasExactRequestOrigin, isLocalRequest, isOperatorRequest } from "@/dashboardGuard";
import { createProvider } from "@/lib/providerRouteHandlers";
import { isString } from "@/shared/utils/typeChecks";

const MAX_AUTH_FILE_BYTES = 16 * 1024;

async function readCliKey() {
  const candidates = [join(homedir(), ".commandcode", "auth.json")];
  if (process.platform === "win32" && process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, "commandcode", "auth.json"));
  }
  for (const file of candidates) {
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_AUTH_FILE_BYTES) continue;
      const buffer = Buffer.alloc(MAX_AUTH_FILE_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_AUTH_FILE_BYTES) continue;
      const key = JSON.parse(buffer.toString("utf8", 0, bytesRead))?.apiKey;
      if (isString(key) && /^user_\S+$/.test(key.trim())) return key.trim();
    } catch {
      // Try the next CLI location without reporting paths or file contents.
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  return null;
}

export async function POST(request) {
  if (!isLocalRequest(request) || !hasExactRequestOrigin(request) || !(await isOperatorRequest(request))) {
    return NextResponse.json({ error: "A local dashboard operator must import the CLI connection" }, { status: 403 });
  }

  const apiKey = await readCliKey();
  if (!apiKey) {
    return NextResponse.json({ error: "No Command Code CLI credential found. Run commandcode login first." }, { status: 404 });
  }

  const { name, proxyPoolId } = await request.json().catch(() => ({})) || {};
  return createProvider(new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ provider: "commandcode", name, apiKey, proxyPoolId, createOnly: true })
  }));
}
