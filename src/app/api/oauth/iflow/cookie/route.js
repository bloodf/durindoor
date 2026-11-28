import { NextResponse } from "next/server";
import { createProviderConnection } from "@/lib/localDb";
import { importIflowCookie } from "@/lib/oauth/providerParity/iflow/cookie.js";

/** Import one BXAuth session; never replay a potentially accepted key rotation. */
export async function POST(request) {
  try {
    const { cookie } = await request.json();
    const fields = await importIflowCookie(cookie, { signal: request.signal });
    if (request.signal.aborted) throw new Error("Import cancelled");
    const connection = await createProviderConnection(fields);
    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        expireTime: fields.providerSpecificData.expireTime
      }
    });
  } catch {
    return NextResponse.json({ error: "iFlow cookie import failed" }, { status: 400 });
  }
}
