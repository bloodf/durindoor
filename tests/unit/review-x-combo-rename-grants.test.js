import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("keeps restricted grants on the renamed combo when its old name is reused", async () => {
  const previous = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-rename-grants-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  try {
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    const combo = await db.createCombo({ name: "old", models: ["openai/model"] });
    const key = await db.createApiKey("restricted", "machine", ["old"]);
    await db.updateCombo(combo.id, { name: "renamed" });
    await db.createCombo({ name: "old", models: ["openai/model"] });
    const allowed = (await db.getApiKeys()).find((entry) => entry.id === key.id).allowedCombos;
    expect(allowed).toContain("renamed");
    expect(allowed).not.toContain("old");
  } finally {
    global._dbAdapter?.instance?.close?.();
    delete global._dbAdapter;
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
