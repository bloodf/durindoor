# Contributing to DurinDoor

## Development workflow

1. Fork the repository.
2. Create a branch from `dev`.
3. Make focused, well-scoped changes.
4. Open a pull request targeting `dev`.

## Commits

Use conventional commits:

- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `docs:` — documentation only
- `ci:` — continuous integration / build / deployment
- `chore:` — maintenance, tooling, or other non-code change

## Pull requests

- Fill out the pull request template completely.
- Include tests for behavioral changes.
- Justify any new dependency in the PR description.
- Target `dev` only. Pull requests targeting `main` will be closed.

## Documentation

Documentation lives in `docs/` as English-only Markdown. Do not commit non-English Markdown documentation or generated docs translations. Non-English language assets belong in the web UI localization layer, and the docs web app must not be added back into this repository.

For the full contributor guide, see `docs/development/contributing.md`.

## Review

All pull requests require review by a maintainer and must pass automated checks.
