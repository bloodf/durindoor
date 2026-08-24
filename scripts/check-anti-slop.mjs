#!/usr/bin/env node
/**
 * Required anti-slop / oxlint gate.
 *
 * Runs vendored dmmulroy/anti-slop (via oxlint) with every generic rule as
 * error, then compares aggregated `file\trule\tcount` fingerprints against
 * `tools/oxlint/anti-slop-baseline.tsv`.
 *
 * Why a baseline: enabling all generic rules across the JS gateway produces
 * thousands of pre-existing hits (mostly `no-runtime-typeof`). The process is
 * still required — CI/husky fail on any *new* fingerprint or count increase —
 * without a drive-by rewrite of the product. Shrink the baseline when fixing
 * debt; never grow it except via explicit `--update-baseline` after review.
 *
 * @see docs/development/anti-slop.md
 * @see https://github.com/dmmulroy/anti-slop
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(ROOT, "tools/oxlint/anti-slop-baseline.tsv");
const OXLINT_BIN = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint");

/**
 * Normalize a diagnostic filename to a repo-relative POSIX path.
 * @param {string} filename
 * @param {string} [root]
 * @returns {string}
 */
export function normalizeDiagnosticFile(filename, root = ROOT) {
  const abs = path.isAbsolute(filename) ? filename : path.resolve(root, filename);
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join("/");
}

/**
 * Aggregate oxlint JSON diagnostics into file+rule counts.
 * @param {{ diagnostics?: Array<{ filename?: string, code?: string, severity?: string }> }} report
 * @param {string} [root]
 * @returns {Map<string, number>} map keyed by `file\trule`
 */
export function aggregateDiagnostics(report, root = ROOT) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const diag of report?.diagnostics ?? []) {
    if (diag.severity && diag.severity !== "error") continue;
    const file = normalizeDiagnosticFile(String(diag.filename ?? ""), root);
    const rule = String(diag.code ?? "").trim();
    if (!file || !rule) continue;
    const key = `${file}\t${rule}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Parse baseline TSV (`file\trule\tcount`, `#` comments / blank lines allowed).
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function parseBaseline(text) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length !== 3) {
      throw new Error(`invalid baseline row (want file\\trule\\tcount): ${raw}`);
    }
    const [file, rule, countRaw] = parts;
    const count = Number(countRaw);
    if (!file || !rule || !Number.isInteger(count) || count < 1) {
      throw new Error(`invalid baseline row: ${raw}`);
    }
    const key = `${file}\t${rule}`;
    counts.set(key, (counts.get(key) ?? 0) + count);
  }
  return counts;
}

/**
 * Serialize counts to a stable TSV (sorted by file, then rule).
 * @param {Map<string, number>} counts
 * @returns {string}
 */
export function formatBaseline(counts) {
  const rows = [...counts.entries()]
    .map(([key, count]) => {
      const [file, rule] = key.split("\t");
      return { file, rule, count };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));

  const lines = [
    "# anti-slop baseline — file\\trule\\tcount",
    "# Shrink when fixing debt. Do not grow without explicit review + --update-baseline.",
    ...rows.map((r) => `${r.file}\t${r.rule}\t${r.count}`),
    "",
  ];
  return lines.join("\n");
}

/**
 * Diff current aggregates against the baseline.
 * Failures: new keys, or count increases. Decreases / removals are OK (progress).
 * @param {Map<string, number>} current
 * @param {Map<string, number>} baseline
 * @returns {{ ok: boolean, regressions: string[], improvements: string[] }}
 */
export function diffAgainstBaseline(current, baseline) {
  /** @type {string[]} */
  const regressions = [];
  /** @type {string[]} */
  const improvements = [];

  for (const [key, count] of current) {
    const base = baseline.get(key) ?? 0;
    if (count > base) {
      const [file, rule] = key.split("\t");
      regressions.push(
        base === 0
          ? `NEW ${file} ${rule} count=${count}`
          : `REGRESSED ${file} ${rule} baseline=${base} now=${count}`,
      );
    } else if (count < base) {
      const [file, rule] = key.split("\t");
      improvements.push(`FIXED ${file} ${rule} baseline=${base} now=${count}`);
    }
  }

  for (const [key, base] of baseline) {
    if (!current.has(key)) {
      const [file, rule] = key.split("\t");
      improvements.push(`CLEARED ${file} ${rule} baseline=${base}`);
    }
  }

  regressions.sort();
  improvements.sort();
  return { ok: regressions.length === 0, regressions, improvements };
}

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
  const updateBaseline = argv.includes("--update-baseline");
  const baselinePath =
    argv.find((a) => a.startsWith("--baseline="))?.slice("--baseline=".length) ??
    BASELINE_PATH;

  if (!existsSync(OXLINT_BIN)) {
    console.error(`oxlint binary missing at ${path.relative(ROOT, OXLINT_BIN)}. Run npm ci.`);
    return 1;
  }

  const { report, stderr } = runOxlint();
  if (stderr && /Failed to (parse|load)/i.test(stderr)) {
    console.error(stderr);
    return 1;
  }

  const current = aggregateDiagnostics(report);
  if (updateBaseline) {
    writeFileSync(baselinePath, formatBaseline(current), "utf8");
    console.log(
      `Updated anti-slop baseline (${current.size} file/rule rows) → ${path.relative(ROOT, baselinePath)}`,
    );
    return 0;
  }

  if (!existsSync(baselinePath)) {
    console.error(
      `Missing baseline at ${path.relative(ROOT, baselinePath)}. Run:\n  node scripts/check-anti-slop.mjs --update-baseline`,
    );
    return 1;
  }

  const baseline = parseBaseline(readFileSync(baselinePath, "utf8"));
  const { ok, regressions, improvements } = diffAgainstBaseline(current, baseline);

  if (improvements.length) {
    console.log(`anti-slop improvements (${improvements.length}):`);
    for (const line of improvements.slice(0, 20)) console.log(`  ${line}`);
    if (improvements.length > 20) {
      console.log(`  … ${improvements.length - 20} more`);
    }
    console.log(
      "Tip: refresh the baseline after fixes with `node scripts/check-anti-slop.mjs --update-baseline`.",
    );
  }

  if (!ok) {
    console.error(`anti-slop regressions (${regressions.length}):`);
    for (const line of regressions.slice(0, 50)) console.error(`  ${line}`);
    if (regressions.length > 50) {
      console.error(`  … ${regressions.length - 50} more`);
    }
    console.error(
      "New anti-slop violations are required-gate failures. Fix them or justify a reviewed baseline update.",
    );
    return 1;
  }

  console.log(
    `anti-slop gate OK (${current.size} baseline file/rule rows; ${report.diagnostics?.length ?? 0} current diagnostics, no regressions).`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
