import { defineDocs, defineConfig } from "fumadocs-mdx/config";

// pageSchema requires title (fumadocs-core/source/schema). Existing docs/*.md
// files have none. Keep dir at ../docs and compile only the spike page.
export const docs = defineDocs({
  dir: "../docs",
  docs: { files: ["_smoke.mdx"] },
  meta: { files: ["meta.json"] },
});

export default defineConfig();
