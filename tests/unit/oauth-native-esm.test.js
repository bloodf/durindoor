import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Refs #2313: the OAuth provider modules must load under plain Node ESM, with
// no bundler, Vitest alias or loader to paper over extensionless specifiers.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const oauthDir = join(root, "src/lib/oauth");

// The provider graph that native Node can load. flowStore, flowCompletion and
// proxySelection reach the database through the bundler-only "@/" alias and
// are out of scope; services/ is legacy CLI code with its own dead imports.
const NATIVE_MODULES = [
  "providers.js",
  "providerHelpers.js",
  "cancellation.js",
  "constants/oauth.js",
  "constants/xai.js",
  "utils/pkce.js",
  "orcarouterProvider.js",
  "gheCopilotProvider.js",
  "copilotM365Provider.js",
  "museCodeProvider.js",
  "openferenceProvider.js",
  "freebuffProvider.js",
  "workbuddyProvider.js",
  "zedHostedProvider.js",
  "services/devin-desktop.js",
  "services/minimax-code.js",
];

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const IMPORT_RE = /(?:\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*)(["'])([^"']+)\1/gm;

describe("OAuth native ESM imports (#2313)", () => {
  it("uses explicit file extensions for every relative import in the native modules", () => {
    const offenders = [];
    for (const rel of NATIVE_MODULES) {
      const file = join(oauthDir, rel);
      expect(existsSync(file), rel).toBe(true);
      const source = stripComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(IMPORT_RE)) {
        const spec = match[2];
        if (!spec.startsWith(".")) continue;
        const target = resolve(dirname(file), spec);
        if (!/\.(?:m?js|cjs|json)$/.test(spec) || !existsSync(target)) offenders.push(`${rel}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not use the bare open-sse package specifier inside src/lib/oauth native modules", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js")) {
          for (const match of stripComments(readFileSync(full, "utf8")).matchAll(IMPORT_RE)) {
            if (/^open-sse(?:\/|$)/.test(match[2])) offenders.push(`${full.slice(root.length + 1)}: ${match[2]}`);
          }
        }
      }
    };
    walk(oauthDir);
    expect(offenders).toEqual([]);
  });

  it("imports the provider modules with plain Node and no loader", () => {
    const script = `
      const files = ${JSON.stringify(NATIVE_MODULES.map((rel) => pathToFileURL(join(oauthDir, rel)).href))};
      const out = {};
      for (const href of files) {
        const mod = await import(href);
        out[href.slice(href.lastIndexOf("/oauth/") + 7)] = Object.keys(mod).length;
      }
      const providers = await import(${JSON.stringify(pathToFileURL(join(oauthDir, "providers.js")).href)});
      out.providerNames = providers.getProviderNames();
      console.log(JSON.stringify(out));
    `;
    const stdout = execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "", DATA_DIR: join(root, ".orq-esm-unused") },
      timeout: 60_000,
    });
    const result = JSON.parse(stdout.trim().split("\n").pop());
    expect(result["providers.js"]).toBeGreaterThan(0);
    expect(result.providerNames).toEqual(expect.arrayContaining(["claude", "codex", "kiro"]));
  });
});
