import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  killAppProcesses: vi.fn(async () => {}),
  spawnUpdaterAndExit: vi.fn(),
}));

vi.mock("@/lib/appUpdater", () => ({
  killAppProcesses: mocks.killAppProcesses,
  spawnUpdaterAndExit: mocks.spawnUpdaterAndExit,
}));

const { normalizeTargetVersion } = await import("../../src/shared/utils/updaterVersion.js");
const route = await import("../../src/app/api/version/update/route.js");

const post = (body) =>
  route.POST(new Request("http://localhost/api/version/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

describe("port 9router #1686: selectable updater target version", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
  });

  it("normalizes plain semver and rejects injection-shaped strings", () => {
    expect(normalizeTargetVersion(undefined)).toBe("");
    expect(normalizeTargetVersion("v2.3.4")).toBe("2.3.4");
    expect(normalizeTargetVersion("1.2.3-beta.1")).toBe("1.2.3-beta.1");
    expect(normalizeTargetVersion("1.2.3; rm -rf /")).toBeNull();
    expect(normalizeTargetVersion("latest && curl x")).toBeNull();
    expect(normalizeTargetVersion(123)).toBeNull();
  });

  it("starts the updater pinned to the selected version", async () => {
    const res = await post({ version: "v2.3.4" });
    expect(res.status).toBe(200);
    expect(mocks.spawnUpdaterAndExit).toHaveBeenCalledWith("durindoor@2.3.4");
    expect((await res.json()).version).toBe("2.3.4");
  });

  it("keeps @latest when no version is given", async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(mocks.spawnUpdaterAndExit).toHaveBeenCalledWith("durindoor@latest");
  });

  it("rejects a malformed version before cleanup or spawn", async () => {
    const res = await post({ version: "1.0.0 --registry=http://evil" });
    expect(res.status).toBe(400);
    expect(mocks.killAppProcesses).not.toHaveBeenCalled();
    expect(mocks.spawnUpdaterAndExit).not.toHaveBeenCalled();
  });
});
