import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ enableModels: vi.fn(), disableModels: vi.fn(), getDisabledModels: vi.fn() }));
vi.mock("@/lib/disabledModelsDb", () => db);
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }));
const { DELETE } = await import("../../src/app/api/models/disabled/route.js");
beforeEach(() => vi.clearAllMocks());

it("enables only the requested models in one operation", async () => {
  const result = await DELETE({ url: "http://localhost/api/models/disabled?providerAlias=p&id=alpha&id=beta" });
  expect(result.status).toBe(200);
  expect(db.enableModels).toHaveBeenCalledWith("p", ["alpha", "beta"]);
});

it("enables all only when no id is supplied", async () => {
  await DELETE({ url: "http://localhost/api/models/disabled?providerAlias=p" });
  expect(db.enableModels).toHaveBeenCalledWith("p", []);
  db.enableModels.mockClear();
  const result = await DELETE({ url: "http://localhost/api/models/disabled?providerAlias=p&id=" });
  expect(result.status).toBe(400);
  expect(db.enableModels).not.toHaveBeenCalled();
});
