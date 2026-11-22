import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
const { GET, POST, DELETE } = await import("@/app/api/cli-tools/droid-settings/route.js");
let home;
let previousHome;
beforeEach(async () => {
  previousHome = process.env.HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), "droid-port-"));
  process.env.HOME = home;
  await fs.mkdir(path.join(home, ".factory"));
});
afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await fs.rm(home, { recursive: true, force: true });
});

it("replaces legacy Droid models with generic chat models and preserves unrelated entries and the existing key", async () => {
  const file = path.join(home, ".factory", "settings.json");
  await fs.writeFile(file, JSON.stringify({ customModels: [
    { id: "old", apiKey: "sk_9router", baseUrl: "http://localhost:20128/v1", model: "old" },
    { id: "custom:9Router-0", apiKey: "secret-key", model: "legacy" },
    { id: "custom:other", model: "user" },
  ] }));
  const status = await (await GET()).json();
  expect(status.has9Router).toBe(true);
  expect(status.settings.customModels[0].durinDoorManaged).toBe(true);
  const response = await POST(new Request("http://localhost/api/cli-tools/droid-settings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl: "http://localhost:20128", models: ["new"] }),
  }));
  expect(response.status).toBe(200);
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  expect(saved.customModels.map((model) => model.id)).toEqual(["custom:DurinDoor-0", "custom:other"]);
  expect(saved.customModels[0]).toMatchObject({ model: "new", provider: "generic-chat-completion-api", apiKey: "secret-key" });
  expect((await DELETE()).status).toBe(200);
  expect(JSON.parse(await fs.readFile(file, "utf8")).customModels.map((model) => model.id)).toEqual(["custom:other"]);
});
