import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
const traverse = traverseModule.default || traverseModule;

/** Adapt native controls only. Literal strings and copied HTML stay unchanged.
 * Review links use virtual Next routing; the production branch remains native. */
export function reviewNativeButtons(source, componentPath) {
  if (!/<(?:button|a)\b/.test(source)) return source;
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const edits = [];
  const tags = new Set();
  traverse(ast, { JSXElement({ node }) {
    if (node.openingElement.name.type !== "JSXIdentifier" || !["button", "a"].includes(node.openingElement.name.name)) return;
    const tag = node.openingElement.name.name; tags.add(tag);
    for (const name of [node.openingElement.name, node.closingElement?.name].filter(Boolean)) edits.push({ start: name.start, end: name.end, replacement: tag === "button" ? "V5ReviewNativeButton" : "V5ReviewNativeLink" });
  } });
  if (!edits.length) return source;
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  const imports = [tags.has("button") ? `import V5ReviewNativeButton from ${JSON.stringify(componentPath)};` : "", tags.has("a") ? `import { ReviewNativeLink as V5ReviewNativeLink } from ${JSON.stringify(componentPath)};` : ""].filter(Boolean).join("\n");
  return `${imports}\n${result}`;
}
