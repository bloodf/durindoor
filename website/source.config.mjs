import { defineDocs, defineConfig } from "fumadocs-mdx/config";

// pageSchema requires title (fumadocs-core/source/schema). Existing docs/*.md
// files have none. Keep dir at ../docs and compile only the landing page.
export const docs = defineDocs({
  dir: "../docs",
  docs: { files: ["index.mdx"] },
  meta: { files: ["meta.json"] },
});

export default defineConfig();
