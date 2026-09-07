/**
 * Monaco's stock `vs` and `vs-dark` palettes were never checked against this
 * dashboard's AAA bar, and three token colours fall under it: on the editor
 * surface, dark strings measure 6.15:1, keywords 5.52:1 and comments 4.88:1
 * against a 7:1 requirement, and the light palette fails on strings, numbers
 * and comments. axe reports these as real `color-contrast-enhanced`
 * violations on the rendered `.mtk*` spans.
 *
 * These themes keep Monaco's colour language while clearing 7:1 on the DS
 * editor surface. Every pair is asserted in tests/unit/durin-ds-contrast.test.js.
 */

/** Editor surface, matching `--dd-surface-2` in each theme. */
export const EDITOR_SURFACE = { dark: "#22201C", light: "#F5F0E2" };

/** Token colours, keyed by the Monaco scope they paint. */
export const EDITOR_TOKENS = {
  dark: { string: "#E8B99A", keyword: "#8FC3EE", comment: "#9CC79A", number: "#B5CEA8", variable: "#9CDCFE", plain: "#D7CDBC" },
  light: { string: "#8C1111", keyword: "#0000CC", comment: "#155A15", number: "#0A4A36", variable: "#001080", plain: "#22201C" },
};

const rules = (tokens) => [
  { token: "", foreground: tokens.plain.slice(1) },
  { token: "string", foreground: tokens.string.slice(1) },
  { token: "string.key.json", foreground: tokens.variable.slice(1) },
  { token: "string.value.json", foreground: tokens.string.slice(1) },
  { token: "keyword", foreground: tokens.keyword.slice(1) },
  { token: "keyword.json", foreground: tokens.keyword.slice(1) },
  { token: "comment", foreground: tokens.comment.slice(1), fontStyle: "italic" },
  { token: "number", foreground: tokens.number.slice(1) },
  { token: "variable", foreground: tokens.variable.slice(1) },
];

/** Theme definitions to register with Monaco, keyed by the name to apply. */
export const EDITOR_THEMES = {
  "durin-dark": { base: "vs-dark", inherit: true, rules: rules(EDITOR_TOKENS.dark), colors: { "editor.background": EDITOR_SURFACE.dark, "editorLineNumber.foreground": "#C9C0AF", "editorLineNumber.activeForeground": "#D7CDBC" } },
  "durin-light": { base: "vs", inherit: true, rules: rules(EDITOR_TOKENS.light), colors: { "editor.background": EDITOR_SURFACE.light, "editorLineNumber.foreground": "#4B4438", "editorLineNumber.activeForeground": "#22201C" } },
};

/** Register both themes; safe to call on every editor mount. */
export function registerEditorThemes(monaco) {
  for (const [name, definition] of Object.entries(EDITOR_THEMES)) monaco.editor.defineTheme(name, definition);
}
