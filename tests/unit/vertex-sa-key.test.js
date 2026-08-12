import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/providers/validate/route.js";
import { validateVertexSaKey } from "../../open-sse/services/tokenRefresh.js";

function serviceAccount(private_key) {
  return {
    type: "service_account",
    client_email: "vertex@example.test",
    project_id: "test-project",
    private_key,
  };
}

const rsa2048 = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" });
const rsa1024 = generateKeyPairSync("rsa", { modulusLength: 1024 })
  .privateKey.export({ type: "pkcs8", format: "pem" });

describe("validateVertexSaKey", () => {
  it("accepts an RSA-2048 service-account key", () => {
    expect(validateVertexSaKey(serviceAccount(rsa2048))).toBeNull();
  });

  it("normalizes literal backslash-n sequences before validating", () => {
    const escaped = rsa2048.replace(/\n/g, "\\n");
    expect(validateVertexSaKey(serviceAccount(escaped))).toBeNull();
  });

  it("rejects an RSA-1024 service-account key with an actionable message", () => {
    expect(validateVertexSaKey(serviceAccount(rsa1024))).toBe(
      "Vertex: service account private_key must be RSA-2048 or larger (RS256), got 1024 bits",
    );
  });
});

describe("POST /api/providers/validate - Vertex service account", () => {
  it("surfaces a weak-key rejection instead of attempting opaque crypto validation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({ provider: "vertex", apiKey: JSON.stringify(serviceAccount(rsa1024)) }),
    }));

    expect(await response.json()).toEqual({
      valid: false,
      error: "Vertex: service account private_key must be RSA-2048 or larger (RS256), got 1024 bits",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
