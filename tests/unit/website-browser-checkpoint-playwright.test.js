import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { planWebsiteBrowserShards, extractPlaywrightTests, verifyWebsiteBrowserCoverage } from "../../scripts/local-ci.mjs";
import { findOwnedProcesses, cleanupShardServer } from "../../scripts/lib/website-shard-server.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const cli = path.join(root, "website/node_modules/@playwright/test/cli.js");
const configURL = new URL("../../website/playwright.config.mjs", import.meta.url).href;

describe("browser checkpoint follow-ups", () => {
  it("fails closed when process enumeration fails even with a free port", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "proc-failure-"));
    try {
      // A regular file passes exists checks but cannot be enumerated as procfs.
      const file = path.join(dir, "file");
      writeFileSync(file, "");
      expect(() => findOwnedProcesses("a".repeat(32), { procRoot: file })).toThrow(/enumerate/);
      // A readable procfs with an enumeration error must also fail closed.
      const result = await cleanupShardServer({ owner: "a".repeat(32), port: 4000, procRoot: "/proc", readDirectory: () => { throw new Error("enumeration denied"); },
        probe: async () => false, selfExitMs: 0 });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/enumeration denied/);
      const absent = await cleanupShardServer({ owner: "a".repeat(32), port: 4000,
        procRoot: path.join(dir, "missing"), probe: async () => false });
      expect(absent.ok).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("pins a fresh direct-run port and a short private Chromium directory", async () => {
    const script = `const {default:c}=await import(${JSON.stringify(configURL)}); console.log(JSON.stringify({url:c.use.baseURL,tmp:process.env.TMPDIR,mode:(await import('node:fs')).statSync(process.env.TMPDIR).mode & 511,only:c.forbidOnly}));`;
    const run = (extraEnv = {}) => {
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        env: { PATH: process.env.PATH, TMPDIR: `/tmp/${"long-output-path".repeat(20)}`, ...extraEnv }, timeout: 10000, encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout.trim());
    };
    const a = run();
    expect(a.url).toMatch(/^http:\/\/127.0.0.1:\d+$/);
    // Keep one direct run's port bound while a second config selects its port.
    const held = spawn(process.execPath, ["--input-type=module", "-e", `
      const {default:c}=await import(${JSON.stringify(configURL)});
      const server=(await import('node:net')).createServer();
      server.listen(Number(new URL(c.use.baseURL).port),'127.0.0.1',()=>console.log(c.use.baseURL));
      process.stdin.resume(); process.stdin.on('end',()=>server.close());
    `], { env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] });
    try {
      const heldURL = await new Promise((resolve, reject) => {
        held.once("error", reject);
        held.once("exit", () => reject(new Error("direct run exited before reserving its port")));
        held.stdout.once("data", (data) => resolve(String(data).trim()));
      });
      expect(run().url).not.toBe(heldURL);
    } finally {
      const exited = new Promise((resolve) => held.once("exit", resolve));
      held.stdin.end();
      await exited;
    }
    expect(a.tmp.length).toBeLessThan(40);
    expect(a.mode).toBe(0o700);
    expect(existsSync(a.tmp)).toBe(false);
    expect(a.only).toBe(true);
    expect(run({ WEBSITE_TRANSIENT_PORT: "43219" }).url).toBe("http://127.0.0.1:43219");
  });

  it("rejects an occupied explicit port without attaching to its listener", async () => {
    const server = createServer((socket) => socket.destroy());
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const port = server.address().port;
      const result = spawnSync(process.execPath, [path.join(root, "website/scripts/transient-server.mjs"), "--port", String(port)], {
        env: { PATH: process.env.PATH }, timeout: 10000, encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Refusing to reuse/);
      expect(server.listening).toBe(true);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });

  it("rejects focused tests and plans non-empty shards using actual Playwright groups", async () => {
    const dir = mkdtempSync(path.join(root, "website/.browser-checkpoint-"));
    try {
      const config = path.join(dir, "config.mjs");
      writeFileSync(config, `import c from ${JSON.stringify(configURL)}; export default {...c,testDir:${JSON.stringify(dir)},testMatch:'*.spec.mjs',outputDir:${JSON.stringify(path.join(dir, 'results'))},globalSetup:undefined,webServer:undefined,reporter:'json'};`);
      const spec = path.join(dir, "group.spec.mjs");
      const source = `import {test} from '@playwright/test'; test.describe('serial',()=>{test.describe.configure({mode:'serial'}); for(let i=0;i<6;i++)test('case '+i,()=>{});});`;
      const run = (args = []) => spawnSync(process.execPath, [cli, "test", `--config=${config}`, ...args], {
        cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 15000,
      });
      writeFileSync(spec, source.replace("test('case '", "test['only']('case '"));
      for (const args of [[], ["--list"]]) {
        const focused = run(args);
        expect(focused.status).not.toBe(0);
        expect(focused.stdout).toMatch(/forbid-only|forbidOnly/);
        expect(() => extractPlaywrightTests(JSON.parse(focused.stdout))).toThrow(/error/);
      }
      writeFileSync(spec, source);
      const listed = run(["--list"]);
      expect(listed.status, listed.stdout + listed.stderr).toBe(0);
      const inventory = extractPlaywrightTests(JSON.parse(listed.stdout));
      expect(inventory).toHaveLength(6);
      const shards = await planWebsiteBrowserShards(inventory, async (shard) => {
        const result = run(["--list", `--shard=${shard.shard}`]);
        expect(result.status, result.stderr).toBe(0);
        return extractPlaywrightTests(JSON.parse(result.stdout));
      }, 3);
      expect(shards).toHaveLength(1);
      const executed = run([`--shard=${shards[0].shard}`]);
      expect(executed.status, executed.stderr).toBe(0);
      expect(verifyWebsiteBrowserCoverage(inventory, [{ entries: extractPlaywrightTests(JSON.parse(executed.stdout)) }]).totalTests).toBe(6);
      // Adding a second independent file must permit two non-empty groups.
      writeFileSync(path.join(dir, "other.spec.mjs"), `import {test} from '@playwright/test'; test('independent',()=>{});`);
      const expanded = extractPlaywrightTests(JSON.parse(run(["--list"]).stdout));
      const mixed = await planWebsiteBrowserShards(expanded, async (shard) =>
        extractPlaywrightTests(JSON.parse(run(["--list", `--shard=${shard.shard}`]).stdout)), 3);
      expect(mixed).toHaveLength(2);
      const results = mixed.map((shard) => {
        const result = run([`--shard=${shard.shard}`]);
        expect(result.status, result.stderr).toBe(0);
        return { entries: extractPlaywrightTests(JSON.parse(result.stdout)) };
      });
      expect(verifyWebsiteBrowserCoverage(expanded, results).totalTests).toBe(7);
      await expect(planWebsiteBrowserShards(inventory, async () => [])).rejects.toThrow(/non-empty/);
      await expect(planWebsiteBrowserShards(inventory, async () => [inventory[0]], 1)).rejects.toThrow(/omitted/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
