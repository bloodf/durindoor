import { dirname, join } from "node:path";

/**
 * Next output-file-tracing root. Workspace mode uses the parent dir so hoisted
 * node_modules are traced, but never the filesystem root: tracing `/` copies
 * /proc, /sys and /usr into standalone/ and the build hangs.
 */
export function resolveTracingRoot(projectRoot, mode) {
  if (mode !== "workspace") return projectRoot;
  const parent = join(projectRoot, "..");
  return dirname(parent) === parent ? projectRoot : parent;
}
