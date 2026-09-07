import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const REGISTRY_ID = "\0storybook-provider-registry";
const PROVIDERS_ID = "\0storybook-provider-index";


/** Project real catalog data without executing registry modules in Vite/browser. */
export async function createProviderMetadataPlugin(projectRoot) {
  const sandbox = await mkdtemp(join(tmpdir(), "storybook-provider-metadata-"));
  let projected;
  try {
    const childPath = fileURLToPath(new URL("./project-provider-metadata.mjs", import.meta.url));
    const { stdout } = await execFile(process.execPath, [childPath, projectRoot], {
      cwd: projectRoot,
      env: { PATH: process.env.PATH || "", HOME: sandbox, DATA_DIR: sandbox },
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const results = stdout.split(/\r?\n/).filter((line) => line.startsWith("DURIN_UI_METADATA "));
    if (results.length !== 1) throw new Error("Provider metadata result missing or duplicated");
    projected = JSON.parse(results[0].slice("DURIN_UI_METADATA ".length));
    if (!Array.isArray(projected.registry) || !projected.models) throw new Error("Invalid provider metadata projection");
  } finally { await rm(sandbox, { recursive: true, force: true }); }
  const registryPath = join(projectRoot, "open-sse/providers/registry/index.js");
  const providersPath = join(projectRoot, "open-sse/providers/index.js");
  return {
    name: "storybook-provider-metadata",
    enforce: "pre",
    resolveId(id, importer) {
      const target = id.startsWith(".") && importer ? resolve(dirname(importer), id) : id;
      if (target === "open-sse/providers/registry/index.js" || target === registryPath) return REGISTRY_ID;
      if (target === "open-sse/providers/index.js" || target === providersPath) return PROVIDERS_ID;
      return null;
    },
    load(id) {
      if (id === REGISTRY_ID) return `export default ${JSON.stringify(projected.registry)};`;
      if (id === PROVIDERS_ID) return `export const PROVIDER_MODELS = ${JSON.stringify(projected.models)}; export const PROVIDERS = ${JSON.stringify(projected.providers)}; export const PROVIDER_MEDIA = ${JSON.stringify(projected.media)}; export const PROVIDER_OAUTH = ${JSON.stringify(projected.oauth)};`;
      return null;
    },
  };
}
