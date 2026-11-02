import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
const traverse = traverseModule.default || traverseModule;

/** Adapt real JSX glyphs while preserving copied markup and production imports. */
export function reviewGlyphs(source, componentPath) {
  if (!source.includes("material-symbols-outlined") && !source.includes('data-icon-name="language"')) return source;
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const edits = [];
  traverse(ast, { JSXElement({ node }) {
    if (node.openingElement.name.type !== "JSXIdentifier" || node.openingElement.name.name !== "span") return;
    const attribute = node.openingElement.attributes.find((attr) => attr.type === "JSXAttribute" && attr.name.name === "className");
    const language = node.openingElement.attributes.some((attr) => attr.type === "JSXAttribute" && attr.name.name === "data-icon-name" && attr.value?.value === "language");
    if (!language && (!attribute?.value || !source.slice(attribute.value.start, attribute.value.end).includes("material-symbols-outlined"))) return;
    for (const name of [node.openingElement.name, node.closingElement?.name].filter(Boolean)) edits.push({ start: name.start, end: name.end });
  } });
  if (!edits.length) return source;
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + "V5ReviewGlyph" + result.slice(edit.end);
  return `import V5ReviewGlyph from ${JSON.stringify(componentPath)};\n${result}`;
}
