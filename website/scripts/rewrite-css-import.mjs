export const CSS_IMPORT_PATTERN = /@import "tailwindcss" source\("[^"]*"\);/;
export const CSS_IMPORT_REPLACEMENT = '@import "tailwindcss" source("../../../../src");\n@source "../../";';

export function rewriteCssImport(css, file) {
  if (!CSS_IMPORT_PATTERN.test(css)) {
    throw new Error(`[sync-public] ${file}: CSS import rewrite matched nothing (${CSS_IMPORT_PATTERN})`);
  }
  return css.replace(CSS_IMPORT_PATTERN, CSS_IMPORT_REPLACEMENT);
}
