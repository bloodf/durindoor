# DurinDoor

DurinDoor is a self-hosted AI Gateway that unifies multiple LLM providers behind a single OpenAI-compatible API. Forked from 9router with enhanced features and LOTR-inspired branding.

## Quick Reference

- **npm package**: `durindoor`
- **GitHub**: https://github.com/bloodf/durindoor
- **Port**: 11434 (production), 20127 (dev)
- **Data dir**: `/opt/cortexos/.9router` (shared with 9router for migration compat)

## Compatibility

DurinDoor preserves 9router wire-format identifiers for data migration:
- `sk_9router` API key prefix
- `[providers.9router]` config sections
- `X-Msh-Platform: 9router` header
- `~/.9router/` data directory

## Build

```bash
npm install --no-audit --no-fund
npm run build          # Next.js production build (--webpack)
npm run dev            # Dev server on port 20127
```

## Test

```bash
cd tests && npm install && npx vitest run --reporter=verbose
```

## Conventional Commits

This project uses conventional commits with a custom `port` type:
- `feat:` new feature
- `fix:` bug fix
- `port(upstream): #N — title` for upstream 9router PR ports
- `docs:`, `refactor:`, `ci:`, `chore:`, `revert:`

## Branch Model

- `main` — releases only (protected)
- `dev` — active development, default branch (protected)
- `frontier` — upstream ports + experiments (protected)
