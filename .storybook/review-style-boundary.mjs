/** Let authored utility icon sizes win in review, preserving incumbent styles elsewhere. */
export function reviewIconStyles(source) {
  const pattern = /\.material-symbols-outlined\s*\{[^}]*font-family:[^}]*\}/;
  const match = source.match(pattern);
  if (!match) throw new Error("Material icon base style changed");
  const original = match[0];
  // :where scopes the incumbent rule without changing its original specificity.
  return source.replace(pattern, `@layer base {\n${original}\n}\n:where(html:not([data-v5-review="true"])) ${original}`);
}
