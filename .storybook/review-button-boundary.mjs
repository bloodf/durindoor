import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
const traverse = traverseModule.default || traverseModule;

/** Change JSX tags only. Strings, copied HTML and comments remain literal. */
export function reviewNativeButtons(source, componentPath) {
  if (!/<button\b/.test(source)) return source;
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const edits = [];
  traverse(ast, { JSXElement({ node }) {
    if (node.openingElement.name.type !== "JSXIdentifier" || node.openingElement.name.name !== "button") return;
    for (const name of [node.openingElement.name, node.closingElement?.name].filter(Boolean)) edits.push({ start: name.start, end: name.end });
  } });
  if (!edits.length) return source;
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + "V5ReviewNativeButton" + result.slice(edit.end);
  return `import V5ReviewNativeButton from ${JSON.stringify(componentPath)};\n${result}`;
}
