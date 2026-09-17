# Contributing to DurinDoor

Open an issue before large changes. Pull requests target `main`.

Use [Node.js 20.20.2](https://nodejs.org/) and npm 10.8.2. Run the test suite and any affected checks before you open the PR. Update docs when behaviour changes.

`npm run lint` runs eslint on `src`, then the anti-slop oxlint gate (`npm run lint:anti-slop`).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `ci`, `chore`, `revert`, `merge`, `port`, `sync`. Subject text maxes out at 100 characters.

## Useful links

- [Contributor guide](docs/contributing/index.mdx)
- [Local development](docs/contributing/local-development.mdx)
- [Release process](docs/contributing/release-process.mdx)
- [Anti-slop vendor notes](tools/oxlint/anti-slop/VENDOR.md)
- [Postgres engine PR template](.github/pr-templates/postgres-engine.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](.github/SECURITY.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
