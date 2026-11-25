// Port of upstream 9router #4305 (availability route): clearing one model's
// cooldown must not mark an account active while another model is still locked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ getProviderConnections: vi.fn(), updateProviderConnection: vi.fn() }));
vi.mock("@/lib/localDb", () => db);
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => Response.json(body, init) } }));

import { POST } from "@/app/api/models/availability/route.js";

const later = () => new Date(Date.now() + 60_000).toISOString();
const earlier = () => new Date(Date.now() - 60_000).toISOString();
const clear = () => POST(new Request("http://localhost/api/models/availability", {
  method: "POST",
  body: JSON.stringify({ action: "clearCooldown", provider: "codex", model: "gpt-a" }),
}));

beforeEach(() => vi.clearAllMocks());

describe("upstream 9router #4305: clearing one cooldown keeps other locks effective", () => {
  it("clears only the lock while another model lock is still active", async () => {
    db.getProviderConnections.mockResolvedValue([
      { id: "a", testStatus: "unavailable", "modelLock_gpt-a": later(), "modelLock_gpt-b": later() },
    ]);

    expect((await clear()).status).toBe(200);
    expect(db.updateProviderConnection.mock.calls).toEqual([["a", { "modelLock_gpt-a": null }]]);
  });

  it("restores the account once the remaining locks have expired", async () => {
    db.getProviderConnections.mockResolvedValue([
      { id: "a", testStatus: "unavailable", "modelLock_gpt-a": later(), "modelLock_gpt-b": earlier() },
    ]);

    await clear();

    expect(db.updateProviderConnection.mock.calls[0][1]).toMatchObject({
      "modelLock_gpt-a": null, testStatus: "active", lastError: null, backoffLevel: 0,
    });
  });
});
