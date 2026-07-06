# Contributing

DurinDoor uses a `dev`-first workflow. Open pull requests against `dev` unless a maintainer asks for a different target.

## Development Workflow

1. Fork or clone the repository.
2. Create a branch from `dev`.
3. Make focused changes.
4. Run the relevant checks.
5. Commit with a conventional commit message.
6. Open a pull request targeting `dev`.

## Branches

| Branch | Purpose |
| --- | --- |
| `dev` | Active development and normal pull request target. |
| `main` | Controlled release branch. Do not target directly unless instructed. |

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
npm install --no-audit --no-fund
npm run dev
```

The development server runs on port `20127`.

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Build the production app. |
| `npm run lint` | Run ESLint for `src/`. |
| `npm run test:ci` | Run the test suite from `tests/`. |
| `npm --prefix cli run pack:cli` | Package the CLI. |

Some environments may need a fresh `npm install` before build or lint commands are available.

## Pull Request Checklist

- The PR targets `dev`.
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
- Do not add generated translation files.
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

