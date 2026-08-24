#!/usr/bin/env node
/**
 * Required anti-slop / oxlint gate.
 *
 * Runs vendored dmmulroy/anti-slop (via oxlint) with every generic rule as
 * error. Exit code is non-zero when any diagnostic remains.
 *
 * @see docs/development/anti-slop.md
 * @see https://github.com/dmmulroy/anti-slop
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OXLINT_BIN = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint");

/**
 * Invoke oxlint and return parsed JSON report.
 * @param {{ root?: string, args?: string[] }} [opts]
 * @returns {{ report: object, status: number, stderr: string }}
 */
export function runOxlint(opts = {}) {
  const root = opts.root ?? ROOT;
  const oxlintBin = path.join(root, "node_modules", "oxlint", "bin", "oxlint");
  const configPath = path.join(root, ".oxlintrc.json");
  const args = opts.args ?? ["-c", configPath, "--quiet", "-f", "json", "."];

  const env = {
    ...process.env,
    // Vendored plugin is TypeScript; Node 20.19+ / 22.6+ strip types for load.
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-strip-types"]
      .filter(Boolean)
      .join(" "),
  };

  const result = spawnSync(oxlintBin, args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = String(result.stdout ?? "").trim();
  if (!stdout) {
    throw new Error(
      `oxlint produced empty stdout (status=${result.status}). stderr:\n${result.stderr}`,
    );
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `failed to parse oxlint JSON: ${err instanceof Error ? err.message : err}\n---\n${stdout.slice(0, 500)}`,
    );
  }

  return {
    report,
    status: result.status ?? 1,
    stderr: String(result.stderr ?? ""),
  };
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  void argv;

  if (!existsSync(OXLINT_BIN)) {
    console.error(`oxlint binary missing at ${path.relative(ROOT, OXLINT_BIN)}. Run npm ci.`);
    return 1;
  }

  const { report, stderr, status } = runOxlint();
  if (stderr && /Failed to (parse|load)/i.test(stderr)) {
    console.error(stderr);
    return 1;
  }

  const diagnostics = (report.diagnostics ?? []).filter(
    (d) => !d.severity || d.severity === "error",
  );

  if (diagnostics.length > 0) {
    // Re-run with human-readable output for the failure log.
    spawnSync(
      OXLINT_BIN,
      ["-c", path.join(ROOT, ".oxlintrc.json"), "--quiet", "."],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-strip-types"]
            .filter(Boolean)
            .join(" "),
        },
        encoding: "utf8",
        stdio: "inherit",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    console.error(
      `anti-slop gate failed: ${diagnostics.length} error(s). Fix every diagnostic; do not baseline.`,
    );
    return 1;
  }

  if (status !== 0 && diagnostics.length === 0) {
    // oxlint may exit 1 for warnings; --quiet should leave status 0 when clean.
    console.error(stderr);
    return status === null ? 1 : status;
  }

  console.log(
    `anti-slop gate OK (0 diagnostics across ${report.number_of_files ?? "?"} files).`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
