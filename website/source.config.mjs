import { defineDocs, defineConfig } from "fumadocs-mdx/config";

// pageSchema requires title (fumadocs-core/source/schema.d.ts:22-23).
// files is a picomatch list (fumadocs-mdx dist/core-BHawVsTm.js:35).
// Publish user and operator MDX only. AI and maintenance references live in internal/docs/.
// meta.files omitted so the default **/*.{json,yaml} glob picks up nested meta.json.
export const docs = defineDocs({
  dir: "../docs",
  docs: { files: ["**/*.mdx"] },
});

export default defineConfig();
