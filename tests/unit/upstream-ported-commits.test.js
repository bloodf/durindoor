import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/upstream-ported-ids.sh");

describe("direct upstream commit membership", () => {
  it("keeps direct hashes separate from PR numbers and excludes unrelated subjects", () => {
    const repo = mkdtempSync(join(tmpdir(), "dd-upstream-commits-"));
    const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    try {
      git("init", "--quiet");
      git("config", "user.name", "Fixture");
      git("config", "user.email", "fixture@example.invalid");
      for (const subject of [
        "port(upstream): fbcaa28 - bounded completion",
        "port(upstream): 7111db3 - real usage",
        "port(upstream): 7111db3 - duplicate evidence",
        "port(upstream): #4482+#4476 - trailing turns and usage",
        "port(omniroute): a99cf57 - not a 9router port",
        "docs(upstream): mention 5e9bd46 but do not port it"
      ]) git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--allow-empty", "-m", subject);
      mkdirSync(join(repo, ".github"));
      writeFileSync(join(repo, ".github/upstream-ported.json"), JSON.stringify({ ported: [{ pr: 42 }] }));
      const commits = JSON.parse(execFileSync(script, ["--commits", repo], { encoding: "utf8" }));
      expect(commits).toEqual(["7111db3", "fbcaa28"]);
      const prs = JSON.parse(execFileSync(script, [repo], { encoding: "utf8" }));
      expect(prs).toEqual([42, 4476, 4482]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});
