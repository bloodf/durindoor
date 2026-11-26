import { describe, expect, it } from "vitest";
import { handleRequest } from "../../relay/worker.js";

const host = "relay.example.com";
const secret = "a".repeat(32);

function setup() {
  const records = new Map();
  const store = { get: async (id) => records.get(id), put: async (id, record) => records.set(id, record) };
  const register = (ownershipSecret, tunnelUrl = "https://first.trycloudflare.com") => handleRequest(new Request(`https://${host}/api/tunnel/register`, {
    method: "POST", body: JSON.stringify({ shortId: "abc123", tunnelUrl, ownershipSecret }),
  }), store, host);
  return { records, store, register };
}

describe("self-hosted relay", () => {
  it("protects claims and stores only a hash of the ownership secret", async () => {
    const { records, register } = setup();
    expect((await register(secret)).status).toBe(200);
    expect(records.get("abc123").secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(records.get("abc123"))).not.toContain(secret);
    expect((await register(undefined)).status).toBe(403);
    expect((await register("b".repeat(32))).status).toBe(403);
    expect((await register("short")).status).toBe(400);
    expect((await register(secret, "https://second.trycloudflare.com")).status).toBe(200);
    expect(records.get("abc123").tunnelUrl).toBe("https://second.trycloudflare.com");
  });

  it("rejects a short initial secret and forwards only to the stored origin", async () => {
    const { store, register } = setup();
    expect((await register("short")).status).toBe(400);
    await register(secret);
    let forwarded;
    const response = await handleRequest(new Request(`https://rabc123.${host}//other.example/path?q=1`), store, host, async (request) => {
      forwarded = request.url;
      return new Response("ok");
    });
    expect(response.status).toBe(200);
    expect(forwarded).toBe("https://first.trycloudflare.com//other.example/path?q=1");
  });
});
