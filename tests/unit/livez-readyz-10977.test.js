// Port of OmniRoute #10977: Kubernetes-style /livez (process-alive) and
// /readyz (readiness alias of the existing health check) probes, ported
// under DurinDoor's /api prefix since routes live at /api/health here.
import { describe, expect, it } from "vitest";
import { GET as healthGet } from "../../src/app/api/health/route.js";
import { GET as livezGet, HEAD as livezHead, OPTIONS as livezOptions } from "../../src/app/api/livez/route.js";
import { GET as readyzGet, OPTIONS as readyzOptions } from "../../src/app/api/readyz/route.js";

describe("port #10977: /api/livez and /api/readyz probes", () => {
  it("/api/livez answers 200 unconditionally", async () => {
    const response = await livezGet();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("/api/livez HEAD answers 200 with no body", async () => {
    const response = await livezHead();
    expect(response.status).toBe(200);
  });

  it("/api/livez OPTIONS answers 204 (CORS preflight)", async () => {
    const response = await livezOptions();
    expect(response.status).toBe(204);
  });

  it("/api/readyz re-exports the same handler as /api/health", () => {
    expect(readyzGet).toBe(healthGet);
  });

  it("/api/readyz GET matches /api/health GET body and status", async () => {
    const [readyzResponse, healthResponse] = await Promise.all([readyzGet(), healthGet()]);
    expect(readyzResponse.status).toBe(healthResponse.status);
    expect(await readyzResponse.json()).toEqual(await healthResponse.json());
  });

  it("/api/readyz OPTIONS answers 204 (CORS preflight)", async () => {
    const response = await readyzOptions();
    expect(response.status).toBe(204);
  });
});
