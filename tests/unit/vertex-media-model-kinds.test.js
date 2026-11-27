import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connections: [], disabled: {}, fail: false, access: null }));
vi.mock("@/sse/services/freeProviderGate.js", () => ({ isFreeNoAuthProviderDisabled: (id) => id !== "vertex" && id !== "unknown-provider" }));
vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: vi.fn(async () => ({ id: "synthetic-caller", isActive: true, policy: { modelAccess: state.access } })),
  getApiKeyProviderConnectionIds: vi.fn(async () => ["synthetic-vertex"]),
  getProviderConnections: vi.fn(async () => state.connections),
  getCombos: vi.fn(async () => []), getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})), getProviderNodes: vi.fn(async () => []),
  getSyncedModelCatalogs: vi.fn(async () => ({})),
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => {
  if (state.fail) throw new Error("closed discovery failure");
  return {};
}) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => state.disabled) }));
vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({ getSharedModelMetadata: vi.fn(async () => null) }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "synthetic-caller-key" })),
}));
import { buildModelsList, LLM_KIND } from "../../src/shared/models/buildModelsList.js";
import { GET as typed } from "../../src/app/api/v1/models/[...model]/route.js";
import { GET as root } from "../../src/app/api/v1/models/route.js";
import vertex from "../../open-sse/providers/registry/vertex.js";

const stt = vertex.serviceKinds.find((kind) => kind === "stt");
const vx = (rows) => rows.filter((row) => row.owned_by === "vx");
const list = (kinds) => buildModelsList(kinds, undefined, { verifiedKey: {}, allowedConnectionIds: ["synthetic-vertex"] });
const request = (kind) => typed(new Request(`http://localhost/v1/models/${kind}`), { params: Promise.resolve({ model: [kind] }) });
let fetchMock;
beforeEach(() => {
  state.connections = [{ id: "synthetic-vertex", provider: "vertex", isActive: true, accessToken: "synthetic-secret", providerSpecificData: { projectId: "synthetic-project" } }];
  state.disabled = {};
  state.fail = false;
  state.access = null;
  fetchMock = vi.fn(() => { throw new Error("Discovery must not call a provider"); });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { expect(fetchMock).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it("projects the real registered transcription catalog in the builder and public typed route", async () => {
  const expected = vertex.sttConfig.models.map(({ id }) => `vx/${id}`).sort();
  const response = await request(stt);
  expect(response.status).toBe(200);
  const rows = vx((await response.json()).data);
  expect(rows.map(({ id }) => id).sort()).toEqual(expected);
  expect(rows.every((row) => row.kind === stt)).toBe(true);
  expect(JSON.stringify(rows)).not.toMatch(/synthetic-secret|synthetic-project/);
  expect(vx(await list([stt])).map(({ id }) => id).sort()).toEqual(expected);
});
it("preserves chat, root chat and first-kind mixed catalog compatibility", async () => {
  const chat = vx(await list([LLM_KIND]));
  expect(chat.map(({ id }) => id)).toEqual(vertex.models.filter((row) => !row.kind).map(({ id }) => `vx/${id}`));
  const response = await root(new Request("http://localhost/v1/models"));
  expect(response.status).toBe(200);
  expect(vx((await response.json()).data).map(({ id, kind }) => ({ id, kind }))).toEqual(chat.map(({ id, kind }) => ({ id, kind })));
  const mixed = vx(await list([LLM_KIND, stt]));
  expect(mixed.filter(({ id }) => id === "vx/gemini-2.5-flash")).toEqual(chat.filter(({ id }) => id === "vx/gemini-2.5-flash"));
});
it.each(["video", "tts", "music"])("keeps %s distinct", async (kind) => {
  const rows = vx(await list([kind]));
  const expected = kind === "tts" ? vertex.ttsConfig.models : vertex.models.filter((row) => row.kind === kind);
  expect(rows.map(({ id }) => id).sort()).toEqual(expected.map(({ id }) => `vx/${id}`).sort());
  expect(rows.every((row) => row.kind === kind)).toBe(true);
});
it("preserves disabled models, inactive and unknown providers and discovery failures", async () => {
  state.disabled = { vx: ["gemini-2.5-flash"] };
  expect(vx(await list([stt])).some(({ id }) => id === "vx/gemini-2.5-flash")).toBe(false);
  state.connections[0].isActive = false;
  state.connections.push({ id: "unknown", provider: "unknown-provider", isActive: true });
  expect(vx(await list([stt]))).toEqual([]);
  state.fail = true;
  expect((await request(stt)).status).toBe(500);
});

it("honors the scoped caller's model access policy on typed discovery", async () => {
  state.access = { mode: "allow", patterns: ["vx/gemini-2.5-flash"] };
  const response = await request(stt);
  expect(response.status).toBe(200);
  expect(vx((await response.json()).data).map(({ id }) => id)).toEqual(["vx/gemini-2.5-flash"]);
});
