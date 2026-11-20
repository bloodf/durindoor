// Live per-account catalogs for the model picker.
//
// GET /api/providers/[id]/models serves a provider's account-scoped catalog.
// The picker offers it next to the static registry, so an account's own models
// are reachable — a passthrough provider such as CommandCode has no static
// list at all, and Claude's catalog depends on the connected account.
//
// Entries collapse by model id: two connections of the same provider expose
// the same catalog, so the first one wins.

/**
 * Collapse per-connection catalogs into one list; the first model id wins.
 * @param {Array<Array<object>|null|undefined>} catalogs
 * @returns {object[]}
 */
export function mergeLiveCatalogs(catalogs) {
  const merged = new Map();
  for (const catalog of catalogs || []) {
    for (const model of Array.isArray(catalog) ? catalog : []) {
      const id = model?.id || model?.slug || model?.model;
      if (!id || merged.has(id)) continue;
      merged.set(id, model);
    }
  }
  return [...merged.values()];
}

/**
 * Model rows for the picker, shaped like the static registry rows.
 * @param {string} alias provider alias the rows are published under
 * @param {object[]} models live catalog rows
 * @returns {{id: string, name: string, value: string, kind: string|null}[]}
 */
export function liveCatalogModelEntries(alias, models) {
  return (models || []).
    map((model) => {
      // The id is the model id the client sends upstream; a row without one is
      // not selectable and is dropped.
      const id = model?.id || model?.slug || model?.model;
      return {
        id,
        name: model?.name || model?.displayName || id,
        value: `${alias}/${id}`,
        kind: model?.kind || model?.type || null,
      };
    }).
    filter((row) => Boolean(row.id));
}
