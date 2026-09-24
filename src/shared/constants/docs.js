// Public documentation site (Fumadocs, built from docs/ by website/).
export const DOCS_URL = "https://durindoor.vercel.app/docs";

// docsUrl("features/combos") -> https://durindoor.vercel.app/docs/features/combos
export function docsUrl(path = "") {
  const clean = String(path).replace(/^\/+|\.mdx?$/g, "");
  return clean ? `${DOCS_URL}/${clean}` : DOCS_URL;
}
