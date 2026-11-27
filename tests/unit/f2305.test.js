import { afterEach, expect, it, vi } from "vitest";
import api from "../../src/shared/utils/api.js";

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["object", { "x-9r-password": "pw" }],
  ["Headers", new Headers({ "x-9r-password": "pw" })],
  ["pairs", [["x-9r-password", "pw"]]],
])("preserves %s caller headers and defaults JSON content type", async (_, headers) => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetchMock);
  await api.post("/api/items", { name: "x" }, { headers });
  const init = fetchMock.mock.calls[0][1];
  expect(Object.fromEntries(new Headers(init.headers))).toEqual({
    "content-type": "application/json",
    "x-9r-password": "pw",
  });
  expect(init.body).toBe('{"name":"x"}');
});

it.each([
  { "Content-Type": "application/custom" },
  new Headers({ "CONTENT-TYPE": "application/custom" }),
  [["Content-Type", "application/custom"]],
])("keeps the caller content type", async (headers) => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetchMock);
  await api.post("/api/items", {}, { headers });
  expect(Object.fromEntries(new Headers(fetchMock.mock.calls[0][1].headers)))
    .toEqual({ "content-type": "application/custom" });
});
