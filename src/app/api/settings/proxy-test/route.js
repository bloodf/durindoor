import { NextResponse } from "next/server";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { isNumber } from "../../../../shared/utils/typeChecks.js";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await testProxyUrl({
      proxyUrl: body?.proxyUrl,
      testUrl: body?.testUrl,
      timeoutMs: body?.timeoutMs
    });

    if (result?.ok) {
      return NextResponse.json(result);
    }

    const status = isNumber(result?.status) ? result.status : 500;
    return NextResponse.json({ ok: false, error: result?.error || "Proxy test failed" }, { status });
  } catch (err) {
    const message = err?.name === "AbortError" ? "Proxy test timed out" : err?.message || String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}