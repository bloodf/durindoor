#!/usr/bin/env node
/**
 * Generate docs/providers/catalog.mdx from open-sse/providers/registry/*.js
 * (every file except index.js). Model counts come from PROVIDER_MODELS.
 *
 * Usage:
 *   node scripts/gen-provider-catalog.mjs          # write
 *   node scripts/gen-provider-catalog.mjs --check  # compare in memory
 */
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listRegistryFiles, registryDir, root } from "./gen-registry-index.mjs";
import { PROVIDER_MODELS } from "../open-sse/config/providerModels.js";

export const catalogPath = path.join(root, "docs", "providers", "catalog.mdx");

function authLabel(entry) {
  if (entry.authType) return entry.authType;
  if (Array.isArray(entry.authModes) && entry.authModes.length) return entry.authModes.join(", ");
  if (entry.noAuth) return "none";
  if (entry.oauth || entry.hasOAuth) return "oauth";
  if (entry.category) return entry.category;
  return "";
}

function modelCount(entry) {
  const key = entry.alias || entry.id;
  const models = PROVIDER_MODELS[key];
  return Array.isArray(models) ? models.length : 0;
}

function cell(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function docsCell(entry) {
  const url = entry.display?.website;
  if (!url) return "";
  return `[site](${url})`;
}

export async function collectProviders(dir = registryDir) {
  const files = await listRegistryFiles(dir);
  const providers = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const exported = mod.default;
    const entries = Array.isArray(exported) ? exported : exported ? [exported] : [];
    for (const entry of entries) {
      if (!entry || !entry.id) continue;
      providers.push({ file, entry });
    }
  }
  providers.sort((a, b) => (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
  return { files, providers };
}

export async function generateCatalog(dir = registryDir) {
  const { files, providers } = await collectProviders(dir);
  const rows = providers.map(({ entry }) => {
    const name = entry.display?.name || entry.id;
    return `| ${cell(name)} | \`${cell(entry.id)}\` | ${cell(authLabel(entry))} | ${modelCount(entry)} | ${docsCell(entry)} |`;
  });

  return `---
title: Provider catalog
description: Registry providers with id, auth type, model count, and site link.
---

\`scripts/gen-provider-catalog.mjs\` reads the ${files.length} modules in \`open-sse/providers/registry/\` except \`index.js\`. Model counts are \`PROVIDER_MODELS\` lengths from \`open-sse/config/providerModels.js\`. Auth is \`authType\` when set, otherwise \`authModes\`, \`oauth\`, \`noAuth\`, or \`category\`. Site links use \`display.website\`. Run \`npm run gen:provider-catalog\` after a registry change.

| Name | Id | Auth | Models | Docs |
| --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
}

export async function main(opts = {}) {
  const dir = opts.dir ?? registryDir;
  const outPath = opts.outPath ?? catalogPath;
  const check = opts.check ?? false;
  const generated = await generateCatalog(dir);

  if (check) {
    const committed = await readFile(outPath, "utf8").catch(() => "");
    if (generated !== committed) {
      return {
        exitCode: 1,
        dirty: true,
        message:
          "docs/providers/catalog.mdx drift detected. Run `npm run gen:provider-catalog` and commit the result.",
      };
    }
    return { exitCode: 0, dirty: false, message: "docs/providers/catalog.mdx is up to date." };
  }

  await writeFile(outPath, generated);
  return { exitCode: 0, message: `wrote ${outPath}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  const result = await main({ check });
  if (result.exitCode) console.error(result.message);
  else console.log(result.message);
  process.exitCode = result.exitCode;
}
