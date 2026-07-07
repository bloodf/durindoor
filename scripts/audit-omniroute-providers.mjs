#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

export function readDurinDoorProviders(root = repoRoot) {
  const registryDir = join(root, "open-sse", "providers", "registry");
  const indexPath = join(registryDir, "index.js");
  if (existsSync(indexPath)) {
    const exported = readExportedRegistryProviders(readFileSync(indexPath, "utf8"));
    if (exported.size > 0) return exported;
  }

  return new Set(
    readdirSync(registryDir)
      .filter((file) => file.endsWith(".js") && file !== "index.js")
      .map((file) => basename(file, ".js"))
      .sort(),
  );
}

export function readProviderAssets(root = repoRoot) {
  const providersDir = join(root, "public", "providers");
  const assets = new Map();
  if (!existsSync(providersDir)) return assets;
  for (const file of readdirSync(providersDir).sort()) {
    if (statSync(join(providersDir, file)).isFile()) {
      assets.set(basename(file, extname(file)), file);
    }
  }
  return assets;
}

export function readOmniRouteProviders(sourceRoot) {
  const registryDir = join(sourceRoot, "open-sse", "config", "providers", "registry");
  const providers = [];
  for (const id of readdirSync(registryDir).sort()) {
    const file = join(registryDir, id, "index.ts");
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    const usesHelper = /buildOpenAiCompatibleRegistryEntry/.test(source);
    providers.push({
      id,
      path: file,
      alias: readStringField(source, "alias"),
      format: readStringField(source, "format") || (usesHelper ? "openai" : null),
      executor: readStringField(source, "executor") || (usesHelper ? "default" : null),
      baseUrl: readStringField(source, "baseUrl"),
      authType: readStringField(source, "authType") || (usesHelper ? "apikey" : null),
      authHeader: readStringField(source, "authHeader") || (usesHelper ? "bearer" : null),
      authPrefix: readStringField(source, "authPrefix"),
      modelsUrl: readStringField(source, "modelsUrl"),
      passthroughModels: /\bpassthroughModels\s*:\s*true\b/.test(source),
      hasLiteralModels: /\bmodels\s*:\s*\[/.test(source),
      importantFields: detectImportantFields(source),
      usesHelper,
      source,
    });
  }
  return providers;
}

export function buildAudit({ durinRoot = repoRoot, omniRoot, omniCommit = null }) {
  if (!omniRoot) throw new Error("omniRoot is required");
  const durinProviders = readDurinDoorProviders(durinRoot);
  const durinAssets = readProviderAssets(durinRoot);
  const omniAssets = readProviderAssets(omniRoot);
  const omniProviders = readOmniRouteProviders(omniRoot);

  const rows = omniProviders.map((provider) => {
    const present = durinProviders.has(provider.id);
    const localIconPath = durinAssets.get(provider.id) || null;
    const sourceIconPath = omniAssets.get(provider.id) || null;
    const hasLocalIcon = !!localIconPath;
    const hasSourceIcon = !!sourceIconPath;
    return {
      id: provider.id,
      status: present ? "present" : "missing",
      class: classifyProvider(provider),
      executor: provider.executor || "unknown",
      format: provider.format || "unknown",
      authType: provider.authType || "unknown",
      authHeader: provider.authHeader || "unknown",
      authPrefix: provider.authPrefix || "",
      importantFields: provider.importantFields,
      hasLocalIcon,
      hasSourceIcon,
      localIconPath,
      sourceIconPath,
      sourcePath: `open-sse/config/providers/registry/${provider.id}/index.ts`,
    };
  });

  const missing = rows.filter((row) => row.status === "missing");
  const present = rows.filter((row) => row.status === "present");
  const missingLocalIcons = rows.filter((row) => row.hasSourceIcon && !row.hasLocalIcon);

  return {
    source: {
      repository: "https://github.com/diegosouzapw/OmniRoute",
      commit: omniCommit,
    },
    totals: {
      durindoorProviders: durinProviders.size,
      omnirouteProviders: omniProviders.length,
      present: present.length,
      missing: missing.length,
      missingLocalIcons: missingLocalIcons.length,
    },
    classes: countBy(rows, "class"),
    missingClasses: countBy(missing, "class"),
    rows,
  };
}

export function renderMarkdown(audit) {
  const lines = [];
  lines.push("# OmniRoute Provider Port Audit");
  lines.push("");
  lines.push(`Source: ${audit.source.repository}`);
  lines.push(`Source commit: \`${audit.source.commit || "unknown"}\``);
  lines.push("");
  lines.push("This audit is the Phase 1 inventory for the OmniRoute provider-port effort. It is generated with:");
  lines.push("");
  lines.push("```sh");
  lines.push("node scripts/audit-omniroute-providers.mjs \\");
  lines.push("  --source /path/to/OmniRoute \\");
  lines.push(`  --commit ${audit.source.commit || "<source commit>"} \\`);
  lines.push("  --format markdown");
  lines.push("```");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- DurinDoor providers: ${audit.totals.durindoorProviders}`);
  lines.push(`- OmniRoute providers: ${audit.totals.omnirouteProviders}`);
  lines.push(`- Already present by provider id: ${audit.totals.present}`);
  lines.push(`- Missing by provider id: ${audit.totals.missing}`);
  lines.push(`- OmniRoute provider icons missing locally: ${audit.totals.missingLocalIcons}`);
  lines.push("");
  lines.push("## Missing Provider Classes");
  lines.push("");
  for (const [name, count] of Object.entries(audit.missingClasses).sort()) {
    lines.push(`- ${name}: ${count}`);
  }
  lines.push("");
  lines.push("## Missing Providers");
  lines.push("");
  lines.push("| Provider | Class | Executor | Format | Auth | Auth header | Auth prefix | Important fields | Source icon | Local icon |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of audit.rows.filter((item) => item.status === "missing")) {
    lines.push(
      `| \`${row.id}\` | ${row.class} | ${row.executor} | ${row.format} | ${row.authType} | ${row.authHeader} | ${row.authPrefix || "-"} | ${row.importantFields.join(", ") || "-"} | ${iconCell(row.sourceIconPath)} | ${iconCell(row.localIconPath)} |`,
    );
  }
  lines.push("");
  lines.push("## Porting Rules");
  lines.push("");
  lines.push("- `simple-default`: may be ported as a DurinDoor registry entry backed by `DefaultExecutor` after preserving base URL, format, auth header and prefix, model list or passthrough model behavior, and local icon metadata.");
  lines.push("- `Local icon` records the concrete asset filename. Non-`.png` assets need explicit provider icon metadata if a UI path would otherwise default to `/providers/<id>.png`.");
  lines.push("- `Important fields` is a warning list, not a complete conversion spec. Inspect the source registry module before porting each provider.");
  lines.push("- `specialized-executor`: must port or adapt the OmniRoute executor and add executor-specific unit tests before exposing the provider.");
  lines.push("- `web-session`: must include credential parsing/validation tests and a subscription/session risk notice.");
  lines.push("- `oauth-session`: must include OAuth/token lifecycle tests and setup documentation.");
  lines.push("- `unknown`: inspect manually before implementation; do not expose as supported from an audit-only pass.");
  lines.push("");
  lines.push("Generated with `node scripts/audit-omniroute-providers.mjs --source <OmniRoute checkout> --format markdown`.");
  return `${lines.join("\n")}\n`;
}

export function classifyProvider(provider) {
  const id = provider.id.toLowerCase();
  const executor = (provider.executor || "").toLowerCase();
  const source = provider.source.toLowerCase();

  if (id.endsWith("-web") || executor.includes("web") || source.includes("cookie")) {
    return "web-session";
  }
  if (
    provider.authType === "oauth" ||
    id.includes("oauth") ||
    ["agy", "grok-cli", "gitlab-duo", "devin-cli", "trae"].includes(id) ||
    source.includes("refresh_token") ||
    /\boauth\s*:/.test(source)
  ) {
    return "oauth-session";
  }
  if (executor && executor !== "default") {
    return "specialized-executor";
  }
  if (executor === "default" || provider.usesHelper) {
    return "simple-default";
  }
  return "unknown";
}

function readStringField(source, field) {
  const match = source.match(new RegExp(`\\b${field}\\s*:\\s*["']([^"']+)["']`));
  return match ? match[1] : null;
}

function readExportedRegistryProviders(source) {
  const imports = new Map();
  for (const match of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+["']\.\/([^"']+)\.js["']/g)) {
    imports.set(match[1], match[2]);
  }

  const exportMatch = source.match(/export\s+default\s+\[([\s\S]*?)\]\s*;/);
  if (!exportMatch) return new Set();

  const providers = [];
  for (const match of exportMatch[1].matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    const id = imports.get(match[0]);
    if (id) providers.push(id);
  }
  return new Set(providers.sort());
}

function detectImportantFields(source) {
  const fields = [
    "headers",
    "extraHeaders",
    "requestDefaults",
    "baseUrls",
    "responsesBaseUrl",
    "urlSuffix",
    "urlBuilder",
    "chatPath",
    "timeoutMs",
    "forceStream",
    "anonymousApiKey",
    "modelIdPrefix",
    "acceptedModelIdPrefixes",
    "defaultContextLength",
    "modelsUrl",
    "passthroughModels",
  ];
  return fields.filter((field) => new RegExp(`\\b${field}\\s*:`).test(source));
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1;
    return acc;
  }, {});
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function iconCell(assetPath) {
  return assetPath ? `\`${assetPath}\`` : "no";
}

export function verifySourceCommit(sourceRoot, expectedCommit) {
  if (!expectedCommit) return null;
  const actualCommit = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (actualCommit !== expectedCommit) {
    throw new Error(`Source checkout HEAD ${actualCommit} does not match --commit ${expectedCommit}`);
  }
  return actualCommit;
}

function parseArgs(argv) {
  const args = { format: "json", source: process.env.OMNIROUTE_SOURCE || "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") args.source = argv[++i];
    else if (arg === "--format") args.format = argv[++i];
    else if (arg === "--commit") args.commit = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.source) {
    console.log("Usage: node scripts/audit-omniroute-providers.mjs --source <OmniRoute checkout> [--commit <sha>] [--format json|markdown]");
    process.exit(args.help ? 0 : 1);
  }
  const source = resolve(args.source);
  verifySourceCommit(source, args.commit || null);
  const audit = buildAudit({ omniRoot: source, omniCommit: args.commit || null });
  if (args.format === "markdown") process.stdout.write(renderMarkdown(audit));
  else if (args.format === "json") process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  else throw new Error(`Unsupported format: ${args.format}`);
}

/**
 * Node may preserve a symlinked CLI path in process.argv[1] while resolving
 * import.meta.url to the real script path. Canonicalize both paths so the CLI
 * still runs when invoked via /tmp, /private/tmp, or another symlink.
 */
export function isCliEntrypoint(argvPath, moduleUrl) {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return resolve(argvPath) === resolve(fileURLToPath(moduleUrl));
  }
}

if (isCliEntrypoint(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
