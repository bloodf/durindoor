const encoder = new TextEncoder();
const idPattern = /^[a-z0-9]{1,63}$/;

async function digest(secret) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret))),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHashes(left, right) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < 64; index++) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

// The store exposes get(id) and put(id, record); production serializes each ID
// through a Durable Object because KV alone cannot provide atomic ownership.
export async function handleRequest(request, store, relayHost, forward = fetch) {
  const url = new URL(request.url);
  if (url.hostname === relayHost && url.pathname === "/api/tunnel/register" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
    const { shortId, tunnelUrl, ownershipSecret } = body || {};
    if (!idPattern.test(shortId) || !Object.is(shortId, String(shortId))) return new Response("Invalid shortId", { status: 400 });
    const existing = await store.get(shortId);
    if (existing && !Object.is(ownershipSecret, String(ownershipSecret))) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!Object.is(ownershipSecret, String(ownershipSecret)) || ownershipSecret.length < 32) return new Response("Invalid secret", { status: 400 });
    const secretHash = await digest(ownershipSecret);
    if (existing && !equalHashes(existing.secretHash, secretHash)) return new Response("Forbidden", { status: 403 });
    let target;
    try { target = new URL(tunnelUrl); } catch { return new Response("Invalid tunnel URL", { status: 400 }); }
    if (target.protocol !== "https:" || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
      return new Response("Invalid tunnel URL", { status: 400 });
    }
    await store.put(shortId, { tunnelUrl: target.origin, secretHash });
    return new Response("Registered", { status: 200 });
  }
  const suffix = `.${relayHost}`;
  if (!url.hostname.endsWith(suffix)) return new Response("Not found", { status: 404 });
  const label = url.hostname.slice(0, -suffix.length);
  const shortId = label.slice(1);
  if (!label.startsWith("r") || !idPattern.test(shortId)) return new Response("Not found", { status: 404 });
  const record = await store.get(shortId);
  if (!record) return new Response("Not found", { status: 404 });
  const destination = new URL(record.tunnelUrl);
  destination.pathname = url.pathname;
  destination.search = url.search;
  return forward(new Request(destination, request), { redirect: "manual" });
}

export class RelayRegistration {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    // blockConcurrencyWhile protects the read/check/write sequence across awaits.
    return this.state.blockConcurrencyWhile(async () => {
      const store = {
        get: (id) => this.state.storage.get(id),
        put: async (id, record) => {
          await this.state.storage.put(id, record);
          await this.env.RELAY_KV.put(id, JSON.stringify(record));
        },
      };
      return handleRequest(request, store, this.env.RELAY_HOST);
    });
  }
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    let shortId;
    if (url.hostname === env.RELAY_HOST && url.pathname === "/api/tunnel/register" && request.method === "POST") {
      try { shortId = (await request.clone().json())?.shortId; } catch { return new Response("Invalid JSON", { status: 400 }); }
    } else {
      const suffix = `.${env.RELAY_HOST}`;
      if (!url.hostname.endsWith(suffix)) return new Response("Not found", { status: 404 });
      const label = url.hostname.slice(0, -suffix.length);
      if (!label.startsWith("r")) return new Response("Not found", { status: 404 });
      shortId = label.slice(1);
    }
    if (!Object.is(shortId, String(shortId)) || !idPattern.test(shortId)) return new Response("Invalid shortId", { status: 400 });
    return env.RELAY_REGISTRATION.get(env.RELAY_REGISTRATION.idFromName(shortId)).fetch(request);
  },
};

export default worker;
