import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  /** When set, replaces fs.promises.link for fallback coverage. */
  linkImpl: null,
  /** When set, wraps fs.promises.open for write/fsync failure injection. */
  openImpl: null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    link: async (...args) => {
      if (fsMocks.linkImpl) return fsMocks.linkImpl(...args);
      return actual.link(...args);
    },
    open: async (...args) => {
      if (fsMocks.openImpl) return fsMocks.openImpl(actual.open, ...args);
      return actual.open(...args);
    },
  };
});

vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: async () => null,
  getApiKeyUsageLimitStatus: async () => null,
  saveRequestUsage: async () => {},
}));

const dataRoot = mkdtempSync(path.join(tmpdir(), "native-owners-atomic-"));
vi.stubEnv("DATA_DIR", dataRoot);

const { createNativeResourceOwner, readNativeResourceOwner } = await import(
  "@/sse/services/nativeResourceOwners.js"
);
const { observeNativeResponse } = await import("@/sse/services/nativeUsage.js");

function ownersDir() {
  return path.join(dataRoot, "native-resource-owners");
}

function ownerFile(provider, connectionId, resourceId) {
  return path.join(
    ownersDir(),
    createHash("sha256").update(`${provider}\0${connectionId}\0${resourceId}`).digest("hex") + ".json",
  );
}

function linkUnavailable(code) {
  return async () => {
    const err = new Error(`link unavailable: ${code}`);
    err.code = code;
    throw err;
  };
}

afterEach(() => {
  fsMocks.linkImpl = null;
  fsMocks.openImpl = null;
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
    "returns quietly on duplicate create when link fails with %s, preserving the existing owner",
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

      fsMocks.linkImpl = linkUnavailable(code);

      await expect(
        createNativeResourceOwner({ ...first, ownerId: "creator-b" }),
      ).resolves.toBeUndefined();

      expect(readFileSync(target)).toEqual(before);
      expect(readdirSync(ownersDir()).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    },
  );

  it.each(["ENOTSUP", "EPERM"])(
    "creates via exclusive fallback when link fails with %s and no owner exists",
    async (code) => {
      fsMocks.linkImpl = linkUnavailable(code);
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

  it("rethrows EXDEV from link without attempting exclusive fallback", async () => {
    fsMocks.linkImpl = linkUnavailable("EXDEV");
    const owner = {
      ownerId: "creator-exdev",
      provider: "anthropic",
      connectionId: "conn-1",
      resourceId: "file_exdev",
      model: "claude-haiku-4-5",
    };
    await expect(createNativeResourceOwner(owner)).rejects.toMatchObject({ code: "EXDEV" });
    await expect(readNativeResourceOwner("anthropic", "conn-1", "file_exdev")).resolves.toBeNull();
    expect(readdirSync(ownersDir()).filter((name) => !name.startsWith("."))).toEqual([]);
    expect(readdirSync(ownersDir()).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("removes a partial exclusive-create target when fallback write/fsync fails", async () => {
    fsMocks.linkImpl = linkUnavailable("ENOTSUP");
    let targetOpens = 0;
    fsMocks.openImpl = async (actualOpen, filePath, flags, mode) => {
      const handle = await actualOpen(filePath, flags, mode);
      if (flags === "wx" && String(filePath).endsWith(".json")) {
        targetOpens += 1;
        return {
          writeFile: async () => {
            const err = new Error("simulated write failure");
            err.code = "EIO";
            throw err;
          },
          sync: async () => {},
          close: () => handle.close(),
        };
      }
      return handle;
    };

    const owner = {
      ownerId: "creator-partial",
      provider: "anthropic",
      connectionId: "conn-1",
      resourceId: "file_fallback_partial",
      model: "claude-haiku-4-5",
    };
    await expect(createNativeResourceOwner(owner)).rejects.toMatchObject({ code: "EIO" });
    expect(targetOpens).toBe(1);
    await expect(
      readNativeResourceOwner("anthropic", "conn-1", "file_fallback_partial"),
    ).resolves.toBeNull();
    expect(readdirSync(ownersDir()).filter((name) => name.endsWith(".json"))).toEqual([]);
    expect(readdirSync(ownersDir()).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["ENOTSUP", "EPERM"])(
    "does not error the nativeUsage observe path on duplicate create when link fails with %s",
    async (code) => {
      const first = {
        ownerId: "creator-a",
        provider: "anthropic",
        connectionId: "conn-1",
        resourceId: "file_usage_dup",
        model: "claude-haiku-4-5",
      };
      await createNativeResourceOwner(first);
      const target = ownerFile("anthropic", "conn-1", "file_usage_dup");
      const before = readFileSync(target);
      fsMocks.linkImpl = linkUnavailable(code);

      const body = JSON.stringify({ id: "file_usage_dup", type: "file" });
      const observed = observeNativeResponse(
        new Response(body, { headers: { "content-type": "application/json" } }),
        {
          apiKey: null,
          provider: "anthropic",
          model: "claude-haiku-4-5",
          connectionId: "conn-1",
          endpoint: "/v1/files",
          onValue: async (metadata) => {
            const resourceId = metadata?.id;
            if (!resourceId) return;
            await createNativeResourceOwner({ ...first, ownerId: "creator-b", resourceId });
          },
        },
      );

      await expect(observed.json()).resolves.toEqual({ id: "file_usage_dup", type: "file" });
      expect(readFileSync(target)).toEqual(before);
      expect(readdirSync(ownersDir()).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    },
  );
});
