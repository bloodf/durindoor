import { NextResponse } from "next/server";
import { getProxyPoolById, updateProxyPool } from "@/models";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { fetch as undiciFetch } from "undici";
import {
  guardedProbeFetch,
  OutboundUrlGuardError,
} from "open-sse/utils/outboundUrlGuard.js";
import {
  isRelayProxyType,
  RELAY_URL_GUARD,
  validateRelayProxyUrl,
} from "../../relayUrlGuard.js";

async function testVercelRelay(relayUrl, timeoutMs = 30000) {
  const validation = validateRelayProxyUrl(relayUrl);
  if (validation.error) {
    return {
      ok: false,
      status: 400,
      blocked: true,
      error: validation.error,
    };
  }
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await guardedProbeFetch(relayUrl, {
      method: "GET",
      headers: {
        "x-relay-target": "https://api.ipify.org",
        "x-relay-path": "/?format=json",
      },
      signal: controller.signal,
    }, RELAY_URL_GUARD, undiciFetch);
    try { await res.body?.cancel?.(); } catch {}
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    if (err instanceof OutboundUrlGuardError) {
      return {
        ok: false,
        status: 400,
        blocked: true,
        error: err.message,
      };
    }
    return {
      ok: false,
      status: 500,
      error: err?.name === "AbortError" ? "Relay test timed out" : (err?.message || String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/proxy-pools/[id]/test - Test proxy pool entry
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const proxyPool = await getProxyPoolById(id);

    if (!proxyPool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const result = isRelayProxyType(proxyPool.type)
      ? await testVercelRelay(proxyPool.proxyUrl)
      : await testProxyUrl({ proxyUrl: proxyPool.proxyUrl });
    const now = new Date().toISOString();

    await updateProxyPool(id, {
      testStatus: result.ok ? "active" : "error",
      lastTestedAt: now,
      lastError: result.ok ? null : (result.error || `Proxy test failed with status ${result.status}`),
      isActive: result.ok,
    });

    return NextResponse.json(
      {
        ok: result.ok,
        status: result.status,
        statusText: result.statusText || null,
        error: result.error || null,
        elapsedMs: result.elapsedMs || 0,
        testedAt: now,
      },
      result.blocked ? { status: 400 } : undefined
    );
  } catch (error) {
    console.log("Error testing proxy pool:", error);
    return NextResponse.json({ error: "Failed to test proxy pool" }, { status: 500 });
  }
}
