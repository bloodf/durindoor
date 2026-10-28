import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dataRoot = mkdtempSync(path.join(tmpdir(), "native-owners-atomic-"));
vi.stubEnv("DATA_DIR", dataRoot);

const { createNativeResourceOwner, readNativeResourceOwner } = await import(
  "@/sse/services/nativeResourceOwners.js"
);

function ownersDir() {
  return path.join(dataRoot, "native-resource-owners");
}

afterEach(() => {
  rmSync(ownersDir(), { recursive: true, force: true });
});

describe("createNativeResourceOwner atomic publish", () => {
  it("writes a complete owner record readers can parse immediately", async () => {
    const owner = {
      ownerId: "key-a",
      provider: "anthropic",
      connectionId: "conn-1",
      resourceId: "file_atomic_1",
      model: "claude-haiku-4-5",
    };
    await createNativeResourceOwner(owner);
    await expect(readNativeResourceOwner("anthropic", "conn-1", "file_atomic_1")).resolves.toEqual(owner);
    expect(readdirSync(ownersDir()).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the first writer when a second create races the same resource id", async () => {
    const first = {
      ownerId: "creator-a",
      provider: "anthropic",
      connectionId: "conn-1",
      resourceId: "file_race",
      model: "claude-haiku-4-5",
    };
    await createNativeResourceOwner(first);
    await createNativeResourceOwner({ ...first, ownerId: "creator-b" });
    await expect(readNativeResourceOwner("anthropic", "conn-1", "file_race")).resolves.toMatchObject({
      ownerId: "creator-a",
    });
  });

  it("does not leave a durable owner when only a temp sibling exists", async () => {
    mkdirSync(ownersDir(), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(ownersDir(), ".partial.pid.deadbeef.tmp"), '{"ownerId":', { mode: 0o600 });
    await expect(readNativeResourceOwner("anthropic", "conn-1", "never-published")).resolves.toBeNull();
    expect(readdirSync(ownersDir()).filter((name) => name.endsWith(".json"))).toEqual([]);
  });
});
