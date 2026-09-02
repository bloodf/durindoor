import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { PRAGMA_SQL } from "../../src/lib/db/schema.js";

describe("SQLite PRAGMA initialization", () => {
  it("sets busy timeout before WAL mode and waits for a held file lock", async () => {
    const busyIdx = PRAGMA_SQL.indexOf("PRAGMA busy_timeout = 5000");
    const walIdx = PRAGMA_SQL.indexOf("PRAGMA journal_mode = WAL");
    expect(busyIdx).toBeGreaterThanOrEqual(0);
    expect(walIdx).toBeGreaterThanOrEqual(0);
    expect(busyIdx).toBeLessThan(walIdx);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-pragma-"));
    const databasePath = path.join(tempDir, "db.sqlite");
    const holder = new Database(databasePath);

    // Disable the driver-level busy timeout so the child cannot wait unless
    // the shared PRAGMA_SQL installs one before WAL. The holder keeps the
    // default (5000ms) so its own BEGIN EXCLUSIVE is uncontested. The child
    // runs in a separate Node process, so better-sqlite3's synchronous
    // exec() does not block the parent event loop from releasing the lock.
    const childModule = `
      import Database from "better-sqlite3";
      import { PRAGMA_SQL } from ${JSON.stringify(new URL("../../src/lib/db/schema.js", import.meta.url).href)};
      const db = new Database(process.argv[1], { timeout: 0 });
      process.stdout.write("ready\\n");
      let started = false;
      process.stdin.on("data", () => {
        if (started) return;
        started = true;
        try {
          db.exec(PRAGMA_SQL);
        } catch (error) {
          process.stderr.write(error.message);
          process.exitCode = 1;
        } finally {
          db.close();
          process.stdin.destroy();
        }
      });
      process.stdin.on("end", () => {
        if (!started) {
          process.stderr.write("parent closed stdin before sending go\\n");
          process.exitCode = 2;
        }
      });
    `;

    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", childModule, databasePath],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    try {
      const ready = (async () => {
        let buf = "";
        for await (const chunk of child.stdout) {
          buf += chunk;
          if (buf.includes("ready\n")) return;
        }
        throw new Error("child closed before signaling ready: " + stderr);
      })();

      await ready;
      holder.exec("BEGIN EXCLUSIVE");
      child.stdin.write("go\n");
      setTimeout(() => {
        try { holder.exec("COMMIT"); } catch {}
      }, 750);

      const [code] = await once(child, "exit");
      expect(code, stderr).toBe(0);
    } finally {
      if (holder.inTransaction) holder.exec("ROLLBACK");
      holder.close();
      if (child.exitCode === null) child.kill();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 10000);
});
