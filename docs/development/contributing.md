# Contributing

DurinDoor uses a single-branch workflow on `main` (post v2.2.0). Open pull requests against `main`.

## Development Workflow

1. Fork or clone the repository.
2. Create a branch from `main`.
3. Make focused changes.
4. Run the relevant checks.
5. Commit with a conventional commit message.
6. Open a pull request targeting `main`.

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Default branch, integration + release source, nightly pre-release source. All pull requests target `main`. |
| (retained) | `dev` was retired in v2.2.0; `release/X.Y.Z` is the cutover branch for production release PRs. |

## Commit Messages

Use Conventional Commits:

```text
type(scope): short description
```

Common types:

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation-only changes
- `refactor:` for behavior-preserving code changes
- `test:` for test additions or updates
- `ci:` for CI changes
- `chore:` for maintenance
- `port(upstream): #N - title` for upstream 9Router ports

## Local Setup

```bash
nvm use
npm ci --no-audit --no-fund
npm run dev
```

The development server runs on port `20127`.

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Build the production app. |
| `npm run lint` | Run ESLint for `src/`. |
| `cd tests && npm run test:ci` | Run the fail-closed test and baseline gate. |
| `npm --prefix cli run pack:cli` | Package the CLI. |

Use Node `20.20.2` and npm `10.8.2`; update and commit lockfiles when dependencies change.

## Pull Request Checklist

- The PR targets `main`.
- The change is scoped and explained.
- Docs are updated when behavior changes.
- Relevant tests or manual validation are listed.
- New dependencies are justified.
- Screenshots are included for UI changes.
- Secrets and local credentials are not committed.

## Documentation Contributions

Documentation lives in `docs/` as Markdown.

Rules:

- Keep English docs as the canonical source.
- Preserve stable filenames and heading structure where possible.
- Do not add non-English Markdown documentation or generated translation files.
- Keep non-English language content in the web UI localization layer, such as `public/i18n` and `src/i18n`.
- Do not reintroduce a docs web app in this repository.
- Keep examples copy-pasteable.
- Use placeholders such as `YOUR_DURINDOOR_API_KEY` instead of real secrets.

## Provider Contributions

When adding or changing a provider:

1. Update the provider registry/configuration.
2. Add or update provider models and capability metadata.
3. Add an executor only when the upstream is not generic compatible.
4. Add translator coverage for provider-specific formats.
5. Test streaming and non-streaming paths where applicable.
6. Document setup requirements in `docs/providers/`.

## Review Expectations

Review focuses on:

- correctness
- migration safety
- provider compatibility
- credential safety
- test coverage
- clear user-facing documentation
