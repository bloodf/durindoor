#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@babel/parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

export function readDurinDoorProviders(root = repoRoot) {
  return new Set(scanDurinDoor(root).providers.map((provider) => provider.id));
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
  return scanOmniRoute(sourceRoot).providers;
}

/**
 * Build the provider-port audit by pure static analysis (Babel AST) of both
 * registries; no audited module is imported or executed.
 *
 * Evidence limits: results are only valid for the OmniRoute checkout at
 * `omniCommit`. No pinned upstream matrix is bundled in this repo, so a run
 * without a real checkout proves nothing; `evidence.commitVerified` is true only
 * when the caller asserted the commit via `--commit`. Dynamic ids/fields are
 * listed in `evidence.unresolved` / `row.dynamicFields` instead of being guessed.
 * Local exported ids/aliases are recorded in `evidence.localProviders`. Exact
 * canonical ids take precedence; otherwise only exact id-to-alias bridges count.
 * Shared aliases, display names, filenames and normalized spellings never match.
 * Alias collisions on either side or multiple local candidates are ambiguous,
 * not missing. Unknown aliases keep non-canonical matches ambiguous because
 * collision evidence is incomplete. Literal array spreads resolve recursively.
 * Explicit null/unshadowed undefined aliases are known absent, not dynamic.
 * Membership is identity metadata, never proof of transport/runtime equivalence.
 * Icons remain canonical-id lookups, independent of alias matches.
 * Reproduce issue #1087 with diegosouzapw/OmniRoute at
 * `61e07fb7e0d4e1e76111495d3718c9e4d06d2a62`: fetch that commit with depth 1
 * and blob filtering into a separate Git repository, then sparse-checkout
 * `/open-sse/config/` and `/public/providers/` (non-cone mode). Keep generated
 * JSON/Markdown outside that source checkout so the CLI's clean-tree check holds.
 * Run this CLI with `--source <checkout> --commit <sha> --format json` and again
 * with `--format markdown`. Review unresolved imports before accepting counts;
 * if a required relative dependency lies outside the sparse paths, include that
 * exact path at the same commit rather than executing the upstream registry.
 */
export function buildAudit({ durinRoot = repoRoot, omniRoot, omniCommit = null, commitVerified = false }) {
  if (!omniRoot) throw new Error("omniRoot is required");
  const durin = scanDurinDoor(durinRoot);
  const durinProviders = new Set(durin.providers.map((provider) => provider.id));
  const durinAssets = readProviderAssets(durinRoot);
  const omniAssets = readProviderAssets(omniRoot);
  const omni = scanOmniRoute(omniRoot);
  const omniProviders = omni.providers;
  const localNames = indexProviderNames(durin.providers);
  const sourceNames = indexProviderNames(omniProviders);
  const aliasesComplete = [...durin.providers, ...omniProviders].every((provider) => provider.aliasesComplete);

  const rows = omniProviders.map((provider) => {
    const match = matchProviderIdentity(provider, durinProviders, localNames, sourceNames, aliasesComplete);
    const localIconPath = durinAssets.get(provider.id) || null;
    const sourceIconPath = omniAssets.get(provider.id) || null;
    const hasLocalIcon = !!localIconPath;
    const hasSourceIcon = !!sourceIconPath;
    return {
      id: provider.id,
      aliases: provider.aliases,
      aliasesComplete: provider.aliasesComplete,
      status: match.kind === "ambiguous" ? "ambiguous" : match.localIds.length ? "present" : "missing",
      match,
      class: classifyProvider(provider),
      executor: provider.executor || "unknown",
      format: provider.format || "unknown",
      authType: provider.authType || "unknown",
      authHeader: provider.authHeader || "unknown",
      authPrefix: provider.authPrefix || "",
      importantFields: provider.importantFields,
      dynamicFields: provider.dynamicFields,
      hasLocalIcon,
      hasSourceIcon,
      localIconPath,
      sourceIconPath,
      sourcePath: relative(resolve(omniRoot), provider.path),
    };
  });

  const missing = rows.filter((row) => row.status === "missing");
  const present = rows.filter((row) => row.status === "present");
  const missingLocalIcons = rows.filter((row) => row.hasSourceIcon && !row.hasLocalIcon);
  const ambiguous = rows.filter((row) => row.status === "ambiguous");

  return {
    source: {
      repository: "https://github.com/diegosouzapw/OmniRoute",
      commit: omniCommit,
    },
    evidence: {
      method: "static-ast (@babel/parser, no runtime imports)",
      commitVerified,
      unresolved: [
        ...omni.unresolved.map((item) => ({ side: "omniroute", ...item })),
        ...durin.unresolved.map((item) => ({ side: "durindoor", ...item })),
      ],
      duplicateIds: { omniroute: omni.duplicateIds, durindoor: durin.duplicateIds },
      localProviders: durin.providers.map(({ id, aliases, aliasesComplete, path, dynamicFields }) => ({
        id, aliases, aliasesComplete, sourcePath: relative(resolve(durinRoot), path), dynamicFields,
      })),
      aliasCollisions: {
        durindoor: nameCollisions(localNames),
        omniroute: nameCollisions(sourceNames),
      },
    },
    totals: {
      durindoorProviders: durinProviders.size,
      omnirouteProviders: omniProviders.length,
      present: present.length,
      missing: missing.length,
      ambiguous: ambiguous.length,
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
  lines.push(`- Already present by exported identity: ${audit.totals.present}`);
  lines.push(`- Missing by exported identity: ${audit.totals.missing}`);
  lines.push(`- Ambiguous identity matches: ${audit.totals.ambiguous}`);
  lines.push(`- OmniRoute provider icons missing locally: ${audit.totals.missingLocalIcons}`);
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  lines.push(`- Method: ${audit.evidence.method}`);
  lines.push(`- Commit asserted via --commit: ${audit.evidence.commitVerified ? "yes" : "no (HEAD of checkout recorded)"}`);
  lines.push("- Valid only for the recorded source commit; no pinned upstream matrix is bundled.");
  lines.push(`- Statically unresolved items: ${audit.evidence.unresolved.length}`);
  for (const item of audit.evidence.unresolved) {
    lines.push(`  - ${item.side} \`${item.path}\`: ${item.reason}`);
  }
  lines.push("- Identity matches do not establish transport equivalence or runtime support.");
  for (const [side, collisions] of Object.entries(audit.evidence.aliasCollisions)) {
    for (const { name, ids } of collisions) lines.push(`- ${side} alias collision \`${name}\`: ${ids.join(", ")}`);
  }
  lines.push("");
  lines.push("## Local Exported Identities");
  lines.push("");
  lines.push("| Provider | Aliases | Source |");
  lines.push("| --- | --- | --- |");
  for (const provider of audit.evidence.localProviders) {
    lines.push(`| \`${provider.id}\` | ${provider.aliases.join(", ") || "-"} | ${provider.sourcePath} |`);
  }
  lines.push("");
  lines.push("## Identity Matches");
  lines.push("");
  lines.push("| Provider | Status | Match | Local candidates | Identity tokens |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of audit.rows) {
    lines.push(`| \`${row.id}\` | ${row.status} | ${row.match.kind} | ${row.match.localIds.join(", ") || "-"} | ${row.match.tokens.join(", ") || "-"} |`);
  }
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

function indexProviderNames(providers) {
  const names = new Map();
  for (const { id, aliases } of providers) {
    for (const name of [id, ...aliases]) {
      if (!names.has(name)) names.set(name, new Set());
      names.get(name).add(id);
    }
  }
  return names;
}

function nameCollisions(names) {
  return [...names].filter(([, ids]) => ids.size > 1)
    .map(([name, ids]) => ({ name, ids: [...ids].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Match only canonical ids or explicit canonical-id/alias bridges, fail closed on collisions. */
function matchProviderIdentity(provider, localIds, localNames, sourceNames, aliasesComplete) {
  if (localIds.has(provider.id)) return { kind: "canonical-id", localIds: [provider.id], tokens: [provider.id] };
  const candidates = new Set();
  const tokens = new Set();
  for (const name of [provider.id, ...provider.aliases]) {
    for (const id of localNames.get(name) || []) {
      if (name !== provider.id && name !== id) continue;
      candidates.add(id);
      tokens.add(name);
    }
  }
  const collision = [...tokens].some((name) => localNames.get(name).size > 1 || sourceNames.get(name).size > 1);
  return {
    kind: !aliasesComplete || collision || candidates.size > 1 ? "ambiguous" : candidates.size ? "alias" : "none",
    localIds: [...candidates].sort(),
    tokens: [...tokens].sort(),
  };
}

/* ------------------------------------------------------------------ *
 * Static AST resolver. Never executes or imports audited source.
 * ------------------------------------------------------------------ */
// Supported factories return a plain object: expression-bodied destructuring
// arrows or a single return with one identifier parameter (the upstream helper).
// Bind arguments lexically; never execute statements or trust a helper's name.
// Rest/computed patterns and collection calls remain unresolved evidence.

const OMNI_PROVIDER_KEYS = ["format", "executor", "baseUrl", "authType", "models", "passthroughModels"];
const STRING_FIELDS = ["alias", "format", "executor", "baseUrl", "authType", "authHeader", "authPrefix", "modelsUrl"];
const IMPORTANT_FIELDS = [
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
const WRAPPER_TYPES = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ParenthesizedExpression"]);
const IMPORT_SUFFIXES = ["", ".ts", ".js", ".mjs", "/index.ts", "/index.js"];
const MAX_DEPTH = 16;

function unwrap(node) {
  let current = node;
  while (current && WRAPPER_TYPES.has(current.type)) current = current.expression;
  return current;
}

function note(ctx, mod, reason, node) {
  const line = node?.loc?.start?.line;
  const entry = { path: relative(ctx.root, mod.file), reason: line ? `${reason} (line ${line})` : reason };
  ctx.unresolved.set(`${entry.path}\0${entry.reason}`, entry);
}

function importTarget(mod, source) {
  if (!source.startsWith(".")) return null;
  const base = resolve(dirname(mod.file), source);
  for (const suffix of IMPORT_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return loadModule(candidate, mod.ctx);
  }
  return null;
}

/** Parse one file once: top-level bindings, exports, comment-blanked text. */
function loadModule(file, ctx) {
  if (ctx.cache.has(file)) return ctx.cache.get(file);
  const mod = { file, ctx, clean: "", bindings: new Map(), exports: new Map(), stars: [] };
  ctx.cache.set(file, mod);
  const text = readFileSync(file, "utf8");
  mod.clean = text;
  let ast;
  try {
    ast = babel.parse(text, { sourceType: "module", plugins: ["typescript"] });
  } catch (error) {
    note(ctx, mod, `parse error: ${error.message}`);
    return mod;
  }

  // Blank comments (keep offsets) so keyword heuristics ignore them.
  let clean = "";
  let cursor = 0;
  for (const comment of ast.comments || []) {
    clean += text.slice(cursor, comment.start) + text.slice(comment.start, comment.end).replace(/[^\n]/g, " ");
    cursor = comment.end;
  }
  mod.clean = clean + text.slice(cursor);

  const bindUnknownPattern = (pattern) => {
    if (pattern.type === "Identifier") mod.bindings.set(pattern.name, { kind: "value", node: null, mod });
    else if (pattern.type === "RestElement") bindUnknownPattern(pattern.argument);
    else if (pattern.type === "AssignmentPattern") bindUnknownPattern(pattern.left);
    else if (pattern.type === "ArrayPattern") pattern.elements.filter(Boolean).forEach(bindUnknownPattern);
    else if (pattern.type === "ObjectPattern") {
      for (const prop of pattern.properties) bindUnknownPattern(prop.type === "RestElement" ? prop.argument : prop.value);
    }
  };
  const bindDeclaration = (declaration) => {
    const bound = [];
    for (const declarator of declaration.declarations) {
      // Even unsupported declarations must shadow the global undefined value.
      bindUnknownPattern(declarator.id);
      if (declarator.id.type === "Identifier" && declarator.init) {
        const binding = { kind: "value", node: declarator.init, mod };
        mod.bindings.set(declarator.id.name, binding);
        bound.push([declarator.id.name, binding]);
      }
    }
    return bound;
  };
  const pending = [];
  for (const stmt of ast.program.body) {
    if (stmt.type === "ImportDeclaration") {
      for (const spec of stmt.specifiers) {
        if (spec.type === "ImportDefaultSpecifier") {
          mod.bindings.set(spec.local.name, { kind: "import", source: stmt.source.value, imported: "default" });
        } else if (spec.type === "ImportSpecifier") {
          mod.bindings.set(spec.local.name, { kind: "import", source: stmt.source.value, imported: spec.imported.name ?? spec.imported.value });
        } else if (spec.type === "ImportNamespaceSpecifier") {
          mod.bindings.set(spec.local.name, { kind: "value", node: null, mod });
        }
      }
    } else if (stmt.type === "VariableDeclaration") {
      bindDeclaration(stmt);
    } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
      mod.bindings.set(stmt.id.name, { kind: "value", node: stmt, mod });
    } else if (stmt.type === "ClassDeclaration" && stmt.id) {
      bindUnknownPattern(stmt.id);
    } else if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration?.type === "VariableDeclaration") {
        for (const [name, binding] of bindDeclaration(stmt.declaration)) mod.exports.set(name, binding);
      } else if (stmt.declaration?.type === "FunctionDeclaration" && stmt.declaration.id) {
        const binding = { kind: "value", node: stmt.declaration, mod };
        mod.bindings.set(stmt.declaration.id.name, binding);
        mod.exports.set(stmt.declaration.id.name, binding);
      } else if (stmt.declaration?.type === "ClassDeclaration" && stmt.declaration.id) {
        bindUnknownPattern(stmt.declaration.id);
      }
      for (const spec of stmt.specifiers || []) {
        if (spec.type !== "ExportSpecifier") continue;
        const exported = spec.exported.name ?? spec.exported.value;
        const local = spec.local.name ?? spec.local.value;
        if (stmt.source) mod.exports.set(exported, { kind: "import", source: stmt.source.value, imported: local });
        else pending.push([exported, local]);
      }
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const binding = { kind: "value", node: stmt.declaration, mod };
      mod.exports.set("default", binding);
    } else if (stmt.type === "ExportAllDeclaration") {
      mod.stars.push(stmt.source.value);
    }
  }
  for (const [exported, local] of pending) {
    if (mod.bindings.has(local)) mod.exports.set(exported, mod.bindings.get(local));
  }
  return mod;
}

function lookupExport(mod, name, depth = 0) {
  if (mod.exports.has(name)) return mod.exports.get(name);
  if (name === "default" || depth > MAX_DEPTH) return null;
  for (const source of mod.stars) {
    const target = importTarget(mod, source);
    const found = target && lookupExport(target, name, depth + 1);
    if (found) return found;
  }
  return null;
}

function resolveBinding(binding, mod, depth) {
  if (!binding || depth > MAX_DEPTH) return null;
  if (binding.kind === "value") return resolveValue(binding.node, binding.mod || mod, depth + 1);
  const target = importTarget(mod, binding.source);
  return target ? resolveBinding(lookupExport(target, binding.imported), target, depth + 1) : null;
}

/** Follow bindings; retain unshadowed undefined as a known value, null means unknown. */
function resolveValue(node, mod, depth = 0) {
  const current = unwrap(node);
  if (!current || depth > MAX_DEPTH) return null;
  if (current.type === "Identifier") {
    if (current.name === "undefined" && !mod.bindings.has(current.name)) return { node: current, mod };
    return resolveBinding(mod.bindings.get(current.name), mod, depth);
  }
  if (current.type === "ConditionalExpression") {
    const test = resolveValue(current.test, mod, depth + 1);
    if (test?.node.type === "BooleanLiteral") {
      return resolveValue(test.node.value ? current.consequent : current.alternate, mod, depth + 1);
    }
  }
  return { node: current, mod };
}

function resolveObjectFactory(call, mod) {
  const fn = resolveValue(call.callee, mod);
  if (!fn || !["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"].includes(fn.node.type) ||
      fn.node.async || fn.node.generator || fn.node.params.length !== 1 || call.arguments.length !== 1) return null;
  const pattern = fn.node.params[0];
  let body = unwrap(fn.node.body);
  if (pattern.type === "Identifier" && body?.type === "BlockStatement" &&
      body.body.length === 1 && !body.directives.length && body.body[0].type === "ReturnStatement") {
    body = unwrap(body.body[0].argument);
  }
  if (body?.type !== "ObjectExpression" || !["ObjectPattern", "Identifier"].includes(pattern.type)) return null;
  const arg = resolveValue(call.arguments[0], mod);
  if (arg?.node.type !== "ObjectExpression") return null;
  const props = readProps(arg.node, arg.mod);
  if (props.spreadUnresolved) return null;
  const scope = { ...fn.mod, bindings: new Map(fn.mod.bindings) };
  if (pattern.type === "Identifier") {
    scope.bindings.set(pattern.name, { kind: "value", ...arg });
    return { node: body, mod: scope };
  }
  for (const prop of pattern.properties) {
    if (prop.type !== "ObjectProperty" || prop.computed) return null;
    const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
    const param = prop.value.type === "AssignmentPattern" ? prop.value.left : prop.value;
    if (param.type !== "Identifier") return null;
    const value = props.map.get(String(key));
    const fallback = prop.value.type === "AssignmentPattern" ? prop.value.right : null;
    const resolved = value && fallback ? resolveValue(value.node, value.mod) : null;
    const useDefault = !value || (resolved?.node.type === "Identifier" && resolved.node.name === "undefined");
    // Missing parameters shadow module bindings too. Defaults apply to absent
    // or resolved unshadowed undefined values, never null or unknown expressions.
    scope.bindings.set(param.name, !useDefault
      ? { kind: "value", ...value }
      : { kind: "value", node: fallback, mod: scope });
  }
  return { node: body, mod: scope };
}

function readProps(objectNode, mod, depth = 0) {
  const map = new Map();
  let spreadUnresolved = false;
  for (const prop of objectNode.properties) {
    if (prop.type === "SpreadElement") {
      const resolved = depth < MAX_DEPTH ? resolveValue(prop.argument, mod) : null;
      if (resolved?.node.type === "ObjectExpression") {
        const inner = readProps(resolved.node, resolved.mod, depth + 1);
        if (inner.spreadUnresolved) {
          for (const key of map.keys()) map.set(key, { node: null, mod });
        }
        for (const [key, value] of inner.map) map.set(key, value);
        spreadUnresolved ||= inner.spreadUnresolved;
      } else if (resolved?.node.type !== "NullLiteral") {
        // An unknown later spread can overwrite every earlier property.
        for (const key of map.keys()) map.set(key, { node: null, mod });
        spreadUnresolved = true;
      }
      continue;
    }
    if (prop.computed) {
      for (const key of map.keys()) map.set(key, { node: null, mod });
      spreadUnresolved = true;
      continue;
    }
    const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
    map.set(String(key), { node: prop.type === "ObjectProperty" ? prop.value : null, mod });
  }
  return { map, spreadUnresolved };
}

function readString(ref) {
  const resolved = ref?.node && resolveValue(ref.node, ref.mod);
  const node = resolved?.node;
  if (node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked ?? null;
  return null;
}

function readStringList(ref, depth = 0) {
  if (!ref) return { values: [], complete: true };
  const resolved = depth <= MAX_DEPTH && ref.node && resolveValue(ref.node, ref.mod);
  if (resolved?.node.type !== "ArrayExpression") return { values: [], complete: false };
  const values = [];
  let complete = true;
  for (const element of resolved.node.elements) {
    if (element?.type === "SpreadElement") {
      const inner = readStringList({ node: element.argument, mod: resolved.mod }, depth + 1);
      values.push(...inner.values);
      complete &&= inner.complete;
    } else {
      const value = readString({ node: element, mod: resolved.mod });
      if (value === null) complete = false;
      else values.push(value);
    }
  }
  return { values, complete };
}

/** Gather object candidates (objects, helper calls, arrays, spreads, identifiers) from an expression. */
function collect(node, mod, out, depth = 0) {
  if (depth > MAX_DEPTH) return note(mod.ctx, mod, "nesting too deep", node);
  const resolved = resolveValue(node, mod);
  if (!resolved) {
    const bare = unwrap(node);
    if (bare?.type === "Identifier" && mod.bindings.has(bare.name)) note(mod.ctx, mod, `unresolved import ${bare.name}`, bare);
    return;
  }
  const { node: target, mod: owner } = resolved;
  if (target.type === "ObjectExpression") {
    out.push({ node: target, mod: owner, span: target });
  } else if (target.type === "ArrayExpression") {
    for (const element of target.elements) {
      if (!element) continue;
      collect(element.type === "SpreadElement" ? element.argument : element, owner, out, depth + 1);
    }
  } else if (target.type === "CallExpression") {
    const callee = unwrap(target.callee);
    const name = callee?.type === "Identifier" ? callee.name : null;
    const factory = resolveObjectFactory(target, owner);
    if (factory) {
      out.push({ ...factory, span: target, origin: owner });
      return;
    }
    note(owner.ctx, owner, `call ${name || owner.clean.slice(callee.start, callee.end)}() not statically resolvable`, target);
  }
}

function buildEntry(entry, providerSelection) {
  const { ctx } = entry.mod;
  const { map: props, spreadUnresolved } = readProps(entry.node, entry.mod);
  const qualifies = providerSelection === "any-id" ? props.has("id") : OMNI_PROVIDER_KEYS.some((key) => props.has(key));
  if (!qualifies) return null;
  if (!props.has("id") && !spreadUnresolved) return null;
  const id = readString(props.get("id"));
  if (!id) {
    note(ctx, entry.mod, "provider id not statically resolvable", entry.node);
    return null;
  }
  const str = (key) => readString(props.get(key));
  const aliasRef = props.get("alias");
  const aliasNode = aliasRef && resolveValue(aliasRef.node, aliasRef.mod)?.node;
  const aliasAbsent = aliasNode?.type === "NullLiteral" ||
    (aliasNode?.type === "Identifier" && aliasNode.name === "undefined");
  const dynamicFields = STRING_FIELDS.filter((key) => props.has(key) && str(key) === null && !(key === "alias" && aliasAbsent));
  if (spreadUnresolved) dynamicFields.push("<spread>");
  const aliasList = readStringList(props.get("aliases"));
  if (!aliasList.complete) dynamicFields.push("aliases");
  const aliasesComplete = aliasList.complete && !dynamicFields.includes("alias") && !spreadUnresolved;
  if (!aliasesComplete) note(ctx, entry.origin || entry.mod, `provider ${id} aliases not statically resolvable; collision evidence incomplete`, entry.span);
  const aliases = [...new Set([str("alias"), ...aliasList.values].filter((a) => a && a !== id))];
  const refValue = (key) => (props.get(key)?.node ? resolveValue(props.get(key).node, props.get(key).mod) : null);
  const passthrough = refValue("passthroughModels");
  const models = refValue("models");
  if (props.has("models") && models?.node.type !== "ArrayExpression") dynamicFields.push("models");
  return {
    id,
    path: (entry.origin || entry.mod).file,
    alias: str("alias"),
    aliases,
    aliasesComplete,
    format: str("format"),
    executor: str("executor"),
    baseUrl: str("baseUrl"),
    authType: str("authType"),
    authHeader: str("authHeader"),
    authPrefix: str("authPrefix"),
    modelsUrl: str("modelsUrl"),
    passthroughModels: passthrough?.node.type === "BooleanLiteral" && passthrough.node.value === true,
    hasLiteralModels: models?.node.type === "ArrayExpression",
    importantFields: IMPORTANT_FIELDS.filter((field) => props.has(field)),
    dynamicFields,
    source: (entry.origin || entry.mod).clean.slice(entry.span.start, entry.span.end),
  };
}

/**
 * Statically scan `files` and every module reachable through relative imports.
 * Only exported values count; top-level `id` of each exported object is the
 * canonical id, so model constants, nested model ids, comments and unrelated
 * strings can never be mistaken for providers. Duplicate ids merge aliases.
 * Anything not statically resolvable is reported in `unresolved`, never guessed.
 */
function scanProviders(files, providerSelection, root) {
  const ctx = { cache: new Map(), unresolved: new Map(), root };
  const byId = new Map();
  const duplicateIds = new Set();
  const seen = new Set();
  for (const file of files) {
    const mod = loadModule(file, ctx);
    for (const binding of mod.exports.values()) {
      const resolved = resolveBinding(binding, mod, 0);
      if (!resolved) continue;
      const entries = [];
      collect(resolved.node, resolved.mod, entries);
      for (const entry of entries) {
        const key = `${(entry.origin || entry.mod).file}:${entry.span.start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const provider = buildEntry(entry, providerSelection);
        if (!provider) continue;
        const existing = byId.get(provider.id);
        if (existing) {
          duplicateIds.add(provider.id);
          existing.aliases = [...new Set([...existing.aliases, ...provider.aliases])].filter((a) => a !== existing.id);
          existing.aliasesComplete &&= provider.aliasesComplete;
          existing.dynamicFields = [...new Set([...existing.dynamicFields, ...provider.dynamicFields])];
        } else {
          byId.set(provider.id, provider);
        }
      }
    }
  }
  return {
    providers: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
    unresolved: [...ctx.unresolved.values()].sort((a, b) => (a.path + a.reason).localeCompare(b.path + b.reason)),
    duplicateIds: [...duplicateIds].sort(),
  };
}

function scanDurinDoor(root) {
  const registryDir = join(root, "open-sse", "providers", "registry");
  const indexPath = join(registryDir, "index.js");
  if (existsSync(indexPath)) {
    // Index exists: its exports are the only membership; unresolved items surface in evidence.
    return scanProviders([indexPath], "any-id", root);
  }
  const files = readdirSync(registryDir)
    .filter((file) => file.endsWith(".js") && file !== "index.js")
    .sort()
    .map((file) => join(registryDir, file));
  return scanProviders(files, "any-id", root);
}

function scanOmniRoute(sourceRoot) {
  const registryDir = join(sourceRoot, "open-sse", "config", "providers", "registry");
  return scanProviders(findRegistryEntryFiles(registryDir), "registry", sourceRoot);
}

function findRegistryEntryFiles(registryDir) {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name === "index.ts") {
        files.push(path);
      }
    }
  };
  visit(registryDir);
  return files;
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

// -C does not override inherited repository selectors; audit only sourceRoot.
function sourceGitEnv() {
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]) delete env[key];
  return env;
}

export function readSourceHead(sourceRoot) {
  return execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    env: sourceGitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function verifySourceCommit(sourceRoot, expectedCommit) {
  if (!expectedCommit) return null;
  const actualCommit = readSourceHead(sourceRoot);
  if (actualCommit !== expectedCommit) {
    throw new Error(`Source checkout HEAD ${actualCommit} does not match --commit ${expectedCommit}`);
  }
  return actualCommit;
}

export function verifyCleanSourceCheckout(sourceRoot) {
  const status = execFileSync("git", ["-C", sourceRoot, "status", "--porcelain"], {
    encoding: "utf8",
    env: sourceGitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (status.trim()) {
    throw new Error("Source checkout has uncommitted changes; commit or stash them before auditing");
  }
  return true;
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
  verifyCleanSourceCheckout(source);
  // Bind output to the checkout actually read; --commit additionally asserts it.
  const audit = buildAudit({
    omniRoot: source,
    omniCommit: args.commit || readSourceHead(source),
    commitVerified: Boolean(args.commit),
  });
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
