# Upstream PR Ports — #3082, #3114 (2026-08-11)

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3082](https://github.com/decolua/9router/pull/3082) | PORTED | `cleanJSONSchemaForAntigravity` walked every value while pruning `required`, including the `properties` name-map. A user parameter named `required` was treated as a schema keyword and deleted. | Restrict `cleanupRequired` traversal to property-schema values and `items`. Add exact-reproduction coverage. |
| [#3114](https://github.com/decolua/9router/pull/3114) | PORTED | Empty-object placeholder insertion used the same broad walk, so parameter names were again interpreted as schema structure. | Restrict `addPlaceholders` traversal to property-schema values and `items`. Cover nested `type`, real keyword stripping, ghost `required` pruning, and empty-object placeholders. |

## Adaptations

- `ensureObjectType` was already name-map-aware on `origin/main`. `cleanupRequired` and `addPlaceholders` were not — this port fixes both to match its traversal style.
- Auditing the rest of `cleanJSONSchemaForAntigravity`'s pipeline surfaced the same bug in `removeUnsupportedKeywords`: a parameter literally named `default`, `format`, `minLength`, or any `x-`-prefixed key was deleted from the `properties` name-map because the walker recursed via bare `Object.keys(obj)`/`Object.values(obj)`. Fixed in the same pass — restricted to `properties` values and `items`, matching the other three walkers. `convertConstToEnum`, `convertEnumValuesToStrings`, `mergeAllOf`, and `flattenAnyOfOneOf` still walk every value generically; they run in Phase 1/2, before `ensureObjectType` normalizes structure, and are out of scope for this port (#2884 is specifically about the Phase 4/5 closures plus the keyword strip found during verification). Flagged for a follow-up port if a parameter named `const`, `enum`, `allOf`, `anyOf`, or `oneOf` is reported broken.
- Upstream-style broad object recursion was not retained: `properties` is a name-map, so only its values are schema nodes; `items` is the only additional child schema handled by the existing helper pattern.

## Verification

- RED (closures): `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/gemini-schema-walkers-name-map-2884.test.js` failed with `AssertionError: expected { Object (properties) } to have property "required"` at `tests/unit/gemini-schema-walkers-name-map-2884.test.js:30:28`.
- RED (keyword strip): same file, added case `preserves parameter names that match unsupported schema keywords` failed with `AssertionError: expected { actual: { type: 'string' } } to match object { default: { type: 'string' }, …(3) }` at `tests/unit/gemini-schema-walkers-name-map-2884.test.js:92:28`.
- GREEN: same command passed after both fixes: `Test Files  1 passed (1)` and `Tests  6 passed (6)`.

