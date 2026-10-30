import { defineDocs, defineConfig } from "fumadocs-mdx/config";

// pageSchema requires title (fumadocs-core/source/schema.d.ts:22-23).
// files is a picomatch list (fumadocs-mdx dist/core-BHawVsTm.js:35).
// Publish user and operator MDX only. AI and maintenance references live in internal/docs/.
// meta.files omitted so the default **/*.{json,yaml} glob picks up nested meta.json.
export const docs = defineDocs({
  dir: "../docs",
  docs: { files: ["**/*.mdx"] },
});

// Default github-light keywords fall below 4.5:1 on the approved parchment
// code surface. High-contrast token palettes retain syntax while remaining legible.
export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: { themes: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" } },
  },
});
