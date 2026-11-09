import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const gate = join(root, "website/scripts/vercel-ignore-build.sh");

test("Vercel gates real Git history without dependencies or network access", () => {
  const repo = mkdtempSync(join(tmpdir(), "durindoor-vercel-gate-"));
  const env = { PATH: process.env.PATH, HOME: repo, GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Gate test", GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Gate test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (path, value = "input\n") => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), value);
  };
  const commit = () => { git("add", "."); git("commit", "-qm", "fixture"); return git("rev-parse", "HEAD"); };
  let checks = 0;
  const check = (expected, base, overrides = {}, target = "website", cwd = repo) => {
    const result = spawnSync("bash", [gate, target], { cwd, encoding: "utf8", env: {
      ...env, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_PREVIOUS_SHA: base, ...overrides,
    } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, expected, `${target}: ${result.stdout}\n${result.stderr}`);
    checks++;
  };
  try {
    git("init", "-q", "-b", "main");
    write("README.md");
    write("website/src/page.js");
    write("docs/guide.mdx");
    let base = commit();
    check(0, base);
    for (const overrides of [
      { VERCEL_GIT_COMMIT_REF: "feature/nested" },
      { VERCEL_GIT_COMMIT_REF: "dev", VERCEL_ENV: "production" },
      { VERCEL_GIT_COMMIT_REF: "main", VERCEL_ENV: "preview" },
      { VERCEL_GIT_COMMIT_REF: "" }, { VERCEL_ENV: "" },
    ]) check(0, "", overrides);
    for (const missing of ["", "HEAD^", "0".repeat(40), "f".repeat(40), "--help"])
      check(0, missing);
    check(0, base, { VERCEL_GIT_COMMIT_SHA: "f".repeat(40) });
    for (const path of ["README.md", "internal/docs/note.md", "tests/unit/example.js", ".github/workflows/ci.yml"]) {
      write(path, "unrelated\n");
      commit();
      check(0, base);
    }
    for (const path of ["website/src/page.js", "docs/guide.mdx", "src/shared/ui/test.js",
      "open-sse/config/test.js", "public/icons/test.svg", "assets/brand/test.svg",
      "scripts/sync.mjs", "patches/dep.patch", "package.json", "pnpm-lock.yaml",
      "pnpm-workspace.yaml", "jsconfig.json", "next.config.mjs", "postcss.config.mjs",
      ".npmrc", ".nvmrc", ".node-version", "vercel.json", ".vercelignore", "website/pnpm-lock.yaml"]) {
      base = git("rev-parse", "HEAD");
      write(path, `changed ${path}\n`);
      commit();
      check(1, base);
    }
    check(1, base, {}, "website", join(repo, "website"));
    base = git("rev-parse", "HEAD");
    git("mv", "docs/guide.mdx", "internal/docs/moved.mdx");
    commit();
    check(1, base);
    base = git("rev-parse", "HEAD");
    git("mv", "internal/docs/moved.mdx", "docs/renamed.mdx");
    commit();
    check(1, base);
    base = git("rev-parse", "HEAD");
    git("rm", "docs/renamed.mdx");
    commit();
    check(1, base);

    // The last commit alone is unrelated, but earlier integrated inputs changed.
    base = git("rev-parse", "HEAD");
    write("src/shared/ui/test.js", "integrated\n");
    commit();
    write("README.md", "later\n");
    commit();
    check(1, base);
    const tree = git("rev-parse", "HEAD^{tree}");
    const side = git("commit-tree", `${base}^{tree}`, "-p", base, "-m", "side");
    const merge = git("commit-tree", tree, "-p", git("rev-parse", "HEAD"), "-p", side, "-m", "merge");
    git("update-ref", "HEAD", merge);
    check(1, base);
    const squash = git("commit-tree", tree, "-p", base, "-m", "squash");
    git("update-ref", "HEAD", squash);
    check(1, base);
    check(0, merge); // Present but no longer an ancestor: no proven current change.
    check(0, squash);

    base = git("rev-parse", "HEAD");
    write("website/src/page.js", "website only\n");
    commit();
    check(0, base, {}, "app");
    write("custom-server.js");
    commit();
    check(1, base, {}, "app");
    check(0, base, {}, "unknown");

    const shallow = join(repo, "shallow");
    git("clone", "-q", "--depth=1", `file://${repo}`, shallow);
    check(0, base, {}, "website", shallow);
    check(0, base, { VERCEL_GIT_COMMIT_REF: "feature/shallow" }, "website", shallow);
    for (const configPath of ["vercel.json", "website/vercel.json"]) {
      const config = JSON.parse(readFileSync(join(root, configPath), "utf8"));
      assert.deepEqual(config.git.deploymentEnabled, { "**": false, main: true });
      const command = configPath === "vercel.json"
        ? "bash website/scripts/vercel-ignore-build.sh app" : "bash scripts/vercel-ignore-build.sh";
      assert.equal(config.ignoreCommand, command);
    }
    console.log(`${checks} gate exit checks and both Vercel configurations passed`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
