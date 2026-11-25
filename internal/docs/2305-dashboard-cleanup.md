# #2305 dashboard cleanup checklist

Reconciles [#2305](https://github.com/bloodf/durindoor/issues/2305) with the tree.
Status is **partial**: do not close the issue from this list. "This change" means
the commit that last updated this file.

## 1. Duplicate primitive sets

| Item | Status |
| --- | --- |
| Legacy `Card`, `Modal`, `Drawer`, `Pagination` compose the `shared/ui` primitive | Done in earlier commits; each file in `shared/components` is an adapter |
| Remove the `Drawer` and `Pagination` adapters, which have no production importer | Open. Stories and `ui-production-shared-overlays.test.js` still cover them, so removal also removes tests |
| `Button`, `Input`, `Badge` | Open. Their headers record that the `shared/ui` props cannot keep the current DOM and styling |
| `Select`, `Toggle`, `SegmentedControl` | Open. Still separate implementations |
| `Tooltip` | Done. The legacy file composes the `shared/ui` tooltip |
| V5 `DataTable` and `Forms` as a third set | Open |

The open rows need either new props on the `shared/ui` primitives or an accepted
visual change. Neither is a behaviour-preserving swap.

## 2. `shared/ui` README and preview shell

- Done (`a4ce362ba19`): the README calls the components production primitives and
  says that `shared/ui/shell` is a preview, not the shipped shell.

## 3. Shared HTTP client and raw reads

| Item | Status |
| --- | --- |
| Client with status check, non-JSON handling, `AbortSignal` and one error shape | Done (`a4ce362ba19`, `f2be79c29f0`) |
| Health, Timeline, Skills, connection groups and optional provider catalog reads | Done (`4577b90fe72`, `db1f65a5954`, `3c08a3ae533`, `89c900d09f8`, `4bcde3f0031`) |
| Standalone model alias reads | Done in this change, through `shared/utils/modelAliases.js` |
| Model alias reads batched in `ModelsCard.js` and `media-providers/combo/[id]/page.js` | Open. Each shares one `Promise.all` failure path with other reads |
| `ReviewComboFormModal.jsx` alias read | Open. V5 review-scope copy |
| Other raw `fetch(` calls | Open. A text search of `src/app/(dashboard)`, `src/shared` and `src/store` finds 457 matches in 145 files (475 in 146 before this change). The count includes writes and stories |

The alias helper passes `defaultHeaders: false`, so the request stays a bare
`fetch("/api/models/alias")`. Other `api.get` callers still send the JSON
`Content-Type` header.

## 4. Stores and settings

| Item | Status |
| --- | --- |
| Delete `providerStore.js` | Done (`a4ce362ba19`) |
| Delete the unused `userStore.js` and the `store/index.js` barrel | Done in this change |
| Dashboard `/api/settings` reads and writes go through `settingsStore` | Done (`dff7e4f4f5d`, `a4ce362ba19`). Only story assertions call the route directly |
| Repeated `/api/providers` GETs | Open. Several pages still call `fetch` directly, with different cache and abort options |

## 5. Very large pages

| Item | Status |
| --- | --- |
| `providers/[id]/page.js` (2667 lines) split into route-local hooks and sections | Done (`a4ce362ba19`); the page is 15 lines |
| `combos/page.js` editor extraction | Done (`f0f920b933e`) |
| `providers/page.js` provider cards, status badges and test results | Done in this change, under `providers/components/`; the page went from 1161 to 717 lines |

Open: these dashboard files are still over 800 lines.

| File under `src/app/(dashboard)/dashboard/` | Lines |
| --- | --- |
| `usage/components/ProviderLimits/index.js` | 1727 |
| `keys/KeysPageClient.jsx` (handoff: key row extraction) | 1267 |
| `endpoint/EndpointPageClient.jsx` | 1133 |
| `usage/components/ProviderLimits/utils.js` | 1112 |
| `profile/page.js` (handoff: network settings extraction) | 1103 |
| `providers/[id]/sections/ProviderDetailSections.jsx` | 1078 |
| `combos/page.js` | 859 |
| `playground/PlaygroundPageClient.js` | 818 |

## 6. Rejected `v5.css` prototype

- Done (`a4ce362ba19`): `shared/ui/v5/DESIGN.md` records that only the archive
  files `AdminReview.jsx`, `Foundation.stories.jsx` and `Forms.stories.jsx`
  import it, and that acceptance excludes all three.

## Storybook inventory

The four symbols moved out of `providers/page.js` have new rows in
`tests/e2e/storybook-surfaces.json`. They keep the parent page scenarios and stay
pending review. The old rows are in `historicalInventoryRows`. No approved row
changed status. The source hashes were refreshed with
`scripts/sync-storybook-inventory.mjs`. No story file changed, and the index from
`storybook index` matched the recorded `builtIndexSha256`.
