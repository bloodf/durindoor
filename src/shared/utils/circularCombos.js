import { isString } from "./typeChecks.js";

/**
 * Names of the combos that would close a cycle if added to the combo being
 * edited: itself and every combo that reaches it (upstream decolua/9router#2550).
 * Member names resolve like routing and the server's save check: exact first,
 * then case-insensitive; a combo-ref resolves by id first.
 *
 * @param {Array<{id: string, name: string, models?: Array}>} combos
 * @param {{id?: string, names?: Array<string>}|null} context The edited combo's id
 *   and its saved and typed names. A new combo has only a typed name.
 * @returns {Set<string>}
 */
export function getCircularComboNames(combos, context) {
  const names = (context?.names || []).filter(Boolean);
  const targetId = context?.id;
  if (!targetId && names.length === 0) return new Set();

  const target = { id: targetId };
  const nodes = [
    ...combos.filter((combo) => !targetId || combo.id !== targetId),
    ...names.map((name) => ({ ...target, name, isTarget: true })),
  ];
  const resolve = (member) => {
    const ref = !isString(member) && member?.kind === "combo-ref" ? member : null;
    if (ref?.comboId) {
      if (ref.comboId === targetId) return { ...target, isTarget: true };
      const byId = nodes.find((node) => node.id === ref.comboId);
      if (byId) return byId;
    }
    const name = isString(member) ? member : ref?.comboName || ref?.model;
    if (!isString(name)) return null;
    return nodes.find((node) => node.name === name) ||
      nodes.find((node) => node.name.toLowerCase() === name.toLowerCase());
  };
  const reachesTarget = (node, seen) => {
    if (node.isTarget) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    return (node.models || []).some((member) => {
      const nested = resolve(member);
      return Boolean(nested) && reachesTarget(nested, seen);
    });
  };

  return new Set(
    combos
      .filter((combo) => (targetId && combo.id === targetId) || reachesTarget(combo, new Set()))
      .map((combo) => combo.name)
  );
}
