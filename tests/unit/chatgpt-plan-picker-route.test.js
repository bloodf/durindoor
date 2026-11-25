import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ local: true, origin: true, owner: true, verifiedKey: null, dispatch: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: vi.fn(async (id) => ({ id, provider: "chatgpt-plan" })) }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: () => m.local, hasValidCliToken: async () => false, hasValidToken: async () => m.owner }));
vi.mock("@/lib/auth/requestOrigin", () => ({ hasExactRequestOrigin: () => m.origin }));
vi.mock("@/sse/services/modelAccess", () => ({ getRequestModelDiscoveryOptions: async () => ({ verifiedKey: m.verifiedKey }) }));
vi.mock("@/sse/services/chatgptPlanDispatch", () => ({ resolveChatgptPlanDispatch: m.dispatch }));
import { GET } from "../../src/app/api/providers/[id]/models/route.js";
const request = () => new Request("http://localhost/api/providers/selected/models");
const call = () => GET(request(), { params: Promise.resolve({ id: "selected" }) });
describe("owner plan picker catalog", () => {
  beforeEach(() => { vi.stubEnv("DURINDOOR_CHATGPT_PLAN_ENROLLMENT", "1"); m.local = m.origin = m.owner = true; m.verifiedKey = { id: "synthetic", isActive: true }; m.dispatch.mockReset(); });
  it("guards local owner and enabled state before dispatch", async () => {
    for (const key of ["local", "origin", "owner"]) {
      m[key] = false;
      expect((await call()).status).toBe(key === "owner" ? 401 : 404);
      m[key] = true;
    }
    vi.stubEnv("DURINDOOR_CHATGPT_PLAN_ENROLLMENT", "0");
    expect((await call()).status).toBe(404);
    expect(m.dispatch).not.toHaveBeenCalled();
  });
  it("passes the verified key and exact connection to the dispatcher", async () => {
    m.dispatch.mockResolvedValueOnce({ listModels: async () => [{ slug: "private", display_name: "Private" }] });
    const response = await call();
    expect(await response.json()).toMatchObject({ connectionId: "selected", models: [{ id: "private", name: "Private" }] });
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({ preferredConnectionId: "selected", providerRegistered: true, planRequest: { verifiedKey: m.verifiedKey } }));
    m.dispatch.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
  });
});
