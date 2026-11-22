"use server";

import { NextResponse } from "next/server";
import { isLocalRequest } from "@/dashboardGuard";
import { assertPublicUrlResolved, fetchPublic } from "@/shared/utils/ssrfGuard.js";
import { isString } from "../../../../shared/utils/typeChecks.js";

const TIMEOUT_MS = 8000;

// Probe MCP server: initialize + tools/list. No auth header — works for authless servers.
// OAuth servers return 401, signal client to skip tool listing.
// `fetchImpl` defaults to global fetch (local peers probing loopback). Remote
// callers pass fetchPublic so DNS resolution and every redirect hop are checked.
async function probeMcp(url, fetchImpl = fetch) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18"
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const initRes = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "9router", version: "1" } }
      }),
      signal: ac.signal
    });
    if (initRes.status === 401 || initRes.status === 403) {
      return { requiresAuth: true, tools: [] };
    }
    if (!initRes.ok) {
      return { error: `init ${initRes.status}`, tools: [] };
    }
    const sessionId = initRes.headers.get("mcp-session-id") || "";
    await initRes.text().catch(() => {});

    const listHeaders = { ...headers };
    if (sessionId) listHeaders["mcp-session-id"] = sessionId;

    // Step 2: notifications/initialized (required by spec before tools/list)
    await fetchImpl(url, {
      method: "POST",
      headers: listHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      signal: ac.signal
    }).catch(() => {});

    const listRes = await fetchImpl(url, {
      method: "POST",
      headers: listHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      signal: ac.signal
    });
    if (listRes.status === 401 || listRes.status === 403) {
      return { requiresAuth: true, tools: [] };
    }
    const ct = listRes.headers.get("content-type") || "";
    let parsed;
    if (ct.includes("text/event-stream")) {
      // Parse SSE: each "data: {...}" line is a JSON-RPC message
      const text = await listRes.text();
      const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
      for (const line of dataLines) {
        try {
          const obj = JSON.parse(line.replace(/^data:\s*/, ""));
          if (obj?.id === 2 && obj.result) {parsed = obj;break;}
        } catch {/* skip */}
      }
    } else {
      parsed = await listRes.json().catch(() => null);
    }
    const tools = parsed?.result?.tools || [];
    return {
      tools: tools.map((t) => ({ name: t.name, description: t.description || "" }))
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Propagate SSRF blocks so the route can map them to 400 (not a soft probe error).
    if (msg.startsWith("Blocked URL")) throw e;
    return { error: e.name === "AbortError" ? "timeout" : msg, tools: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  try {
    const { url } = await request.json();
    if (!url || !isString(url)) {
      return NextResponse.json({ error: "url required" }, { status: 400 });
    }
    // SSRF guard: remote callers must not pivot this endpoint at internal services
    // (loopback, RFC1918, metadata, localhost). Local peers are exempt so a self-hosted
    // MCP server bound to 127.0.0.1 keeps working. Remote path uses the resolving
    // guard (assertPublicUrlResolved + fetchPublic) so DNS names and redirect hops
    // cannot bypass the string-only check (#2202).
    const local = isLocalRequest(request);
    if (!local) {
      try {
        await assertPublicUrlResolved(url);
      } catch {
        return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
      }
    }
    try {
      const result = await probeMcp(url, local ? fetch : (u, init) => fetchPublic(u, init));
      return NextResponse.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!local && msg.startsWith("Blocked URL")) {
        return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
      }
      throw e;
    }
  } catch (e) {
    return NextResponse.json({ error: e.message, tools: [] }, { status: 500 });
  }
}
