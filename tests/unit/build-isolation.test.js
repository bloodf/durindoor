import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIsolatedBuildEnvironment } from "../../scripts/build-environment.mjs";

const originalBuildFlag = process.env.DURINDOOR_BUILD;
const originalLifecycle = process.env.npm_lifecycle_event;

afterEach(() => {
  if (originalBuildFlag === undefined) delete process.env.DURINDOOR_BUILD;
  else process.env.DURINDOOR_BUILD = originalBuildFlag;
  if (originalLifecycle === undefined) delete process.env.npm_lifecycle_event;
  else process.env.npm_lifecycle_event = originalLifecycle;
  delete global.__appBootstrapped;
  vi.resetModules();
  vi.clearAllMocks();
});

describe("production build isolation", () => {
  it("redirects HOME and DATA_DIR away from caller-owned paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-build-env-"));
    try {
      const env = createIsolatedBuildEnvironment({ HOME: "/real/home", DATA_DIR: "/real/data" }, root);
      expect(env.DURINDOOR_BUILD).toBe("1");
      expect(env.HOME).toBe(path.join(root, "home"));
      expect(env.DATA_DIR).toBe(path.join(root, "data"));
      expect(env.HOME).not.toBe("/real/home");
      expect(env.DATA_DIR).not.toBe("/real/data");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not import or run initializeApp during a build", async () => {
    const initializeApp = vi.fn();
    vi.doMock("../../src/shared/services/initializeApp.js", () => ({ default: initializeApp }));
    process.env.DURINDOOR_BUILD = "1";
    process.env.npm_lifecycle_event = "build";

    await import("../../src/shared/services/bootstrap.js");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(initializeApp).not.toHaveBeenCalled();
    expect(global.__appBootstrapped).toBeUndefined();
  });
});
