import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  /** When set, replaces fs.promises.link for fallback coverage. */
  linkImpl: null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    link: async (...args) => {
      if (fsMocks.linkImpl) return fsMocks.linkImpl(...args);
      return actual.link(...args);
    },
  };
});

const dataRoot = mkdtempSync(path.join(tmpdir(), "native-owners-atomic-"));
vi.stubEnv("DATA_DIR", dataRoot);

const { createNativeResourceOwner, readNativeResourceOwner } = await import(
  "@/sse/services/nativeResourceOwners.js"
);

function ownersDir() {
  return path.join(dataRoot, "native-resource-owners");
}

function ownerFile(provider, connectionId, resourceId) {
  return path.join(
    ownersDir(),
    createHash("sha256").update(`${provider}\0${connectionId}\0${resourceId}`).digest("hex") + ".json",
  );
}

afterEach(() => {
  fsMocks.linkImpl = null;
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

  it.each(["ENOTSUP", "EPERM"])(
    "preserves a pre-existing owner byte-for-byte when link fails with %s",
    async (code) => {
      const first = {
        ownerId: "creator-a",
        provider: "anthropic",
        connectionId: "conn-1",
        resourceId: "file_fallback_preserve",
        model: "claude-haiku-4-5",
      };
      await createNativeResourceOwner(first);
      const target = ownerFile("anthropic", "conn-1", "file_fallback_preserve");
      const before = readFileSync(target);

      fsMocks.linkImpl = async () => {
        const err = new Error(`link unavailable: ${code}`);
        err.code = code;
        throw err;
      };

      await expect(
        createNativeResourceOwner({ ...first, ownerId: "creator-b" }),
      ).rejects.toMatchObject({ code: "EEXIST" });

      expect(readFileSync(target)).toEqual(before);
      expect(readdirSync(ownersDir()).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    },
  );

  it.each(["ENOTSUP", "EPERM"])(
    "creates via exclusive fallback when link fails with %s and no owner exists",
    async (code) => {
      fsMocks.linkImpl = async () => {
        const err = new Error(`link unavailable: ${code}`);
        err.code = code;
        throw err;
      };
      const owner = {
        ownerId: "creator-fallback",
        provider: "anthropic",
        connectionId: "conn-1",
        resourceId: "file_fallback_create",
        model: "claude-haiku-4-5",
      };
      await createNativeResourceOwner(owner);
      await expect(
        readNativeResourceOwner("anthropic", "conn-1", "file_fallback_create"),
      ).resolves.toEqual(owner);
      expect(readdirSync(ownersDir()).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    },
  );
});
