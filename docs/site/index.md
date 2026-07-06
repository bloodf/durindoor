# DurinDoor Documentation Index

> Scaffold-only. Per-locale content files (`docs/i18n/<locale>/...`) are placeholders pending human review per the user mandate: "we can scrape the website docs for now and keep only in the repository as .md files, until we have a 100% stable documentation ready before going with the website."

## English source

- [`README.md`](../README.md) — top-level entry point
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — system architecture overview
- [`docs/pr-mcp-gateway.md`](pr-mcp-gateway.md) — MCP gateway internals

## Locales (snapshot from `public/i18n/literals/`)

Each entry links to a `status.json` (translation progress) and any in-repo `i18n/README.<locale>.md` if present.

- **ar** — _(README missing)_ · [status.json](i18n/ar/status.json)
- **bn** — _(README missing)_ · [status.json](i18n/bn/status.json)
- **cs** — _(README missing)_ · [status.json](i18n/cs/status.json)
- **da** — _(README missing)_ · [status.json](i18n/da/status.json)
- **de** — _(README missing)_ · [status.json](i18n/de/status.json)
- **el** — _(README missing)_ · [status.json](i18n/el/status.json)
- **es** — _(README missing)_ · [status.json](i18n/es/status.json)
- **fi** — _(README missing)_ · [status.json](i18n/fi/status.json)
- **fr** — _(README missing)_ · [status.json](i18n/fr/status.json)
- **he** — _(README missing)_ · [status.json](i18n/he/status.json)
- **hi** — _(README missing)_ · [status.json](i18n/hi/status.json)
- **hu** — _(README missing)_ · [status.json](i18n/hu/status.json)
- **id** — _(README missing)_ · [status.json](i18n/id/status.json)
- **it** — _(README missing)_ · [status.json](i18n/it/status.json)
- **ja** — _(README missing)_ · [status.json](i18n/ja/status.json)
- **ko** — _(README missing)_ · [status.json](i18n/ko/status.json)
- **nl** — _(README missing)_ · [status.json](i18n/nl/status.json)
- **no** — _(README missing)_ · [status.json](i18n/no/status.json)
- **pl** — _(README missing)_ · [status.json](i18n/pl/status.json)
- **pt-BR** — _(README missing)_ · [status.json](i18n/pt-BR/status.json)
- **pt-PT** — _(README missing)_ · [status.json](i18n/pt-PT/status.json)
- **ro** — _(README missing)_ · [status.json](i18n/ro/status.json)
- **ru** — [i18n/README.ru.md](../i18n/README.ru.md) · [status.json](i18n/ru/status.json)
- **sv** — _(README missing)_ · [status.json](i18n/sv/status.json)
- **th** — _(README missing)_ · [status.json](i18n/th/status.json)
- **tl** — _(README missing)_ · [status.json](i18n/tl/status.json)
- **tr** — _(README missing)_ · [status.json](i18n/tr/status.json)
- **uk** — _(README missing)_ · [status.json](i18n/uk/status.json)
- **ur** — _(README missing)_ · [status.json](i18n/ur/status.json)
- **vi** — [i18n/README.vi.md](../i18n/README.vi.md) · [status.json](i18n/vi/status.json)
- **zh-CN** — [i18n/README.zh-CN.md](../i18n/README.zh-CN.md) · [status.json](i18n/zh-CN/status.json)
- **zh-TW** — _(README missing)_ · [status.json](i18n/zh-TW/status.json)

## How to add or update a locale

1. Edit `i18n/README.<locale>.md` directly in-repo.
2. Keep the source English content stable in `docs/ARCHITECTURE.md` / `README.md`.
3. After updating, re-run `node scripts/scrape-docs.mjs` to refresh per-locale `status.json`.
4. Open a PR per locale; reviewers per the brand-sweep-internal AGENTS.md contract must verify both docs and tests where applicable.

## Pending follow-ups

- Per-locale README translations for locales WITHOUT one yet (e.g. many of the 32 locale codes listed).
- Per-page translation matching public/i18n/literals entries to a structured `docs/site/en/` mirror.
- Removal of fallback 9router reads in `i18n/README.<locale>.md` originals during the larger brand-sweep.
