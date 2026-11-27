import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default || traverseModule;

/** Find settings reads without mistaking a scoped object payload for stored settings. */
export function settingsReadKeys(source) {
  if (!/\bsettings(?:Data)?\??\./.test(source)) return [];
  const ast = parse(source, { sourceType: "unambiguous", plugins: ["jsx", "typescript"] });
  const keys = [];
  const visit = (path) => {
    const { object, property, computed } = path.node;
    if (computed || object.type !== "Identifier" || !["settings", "settingsData"].includes(object.name)) return;
    const binding = path.scope.getBinding(object.name);
    const initializer = binding?.path.node.init;
    // A constant local payload is not the application's persisted settings.
    // Keep all spreads in scope (their source may be stored settings), as well
    // as reassigned bindings and objects containing a getSettings() call.
    if (binding?.constant && initializer?.type === "ObjectExpression" &&
        initializer.properties.every((property) => property.type !== "SpreadElement") &&
        !/\bgetSettings(?:Sync)?\s*\(/.test(source.slice(initializer.start, initializer.end))) return;
    keys.push(property.name);
  };
  traverse(ast, { MemberExpression: visit, OptionalMemberExpression: visit });
  return keys;
}
