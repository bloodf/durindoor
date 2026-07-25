# DurinDoor README Handbook Revamp

**Date:** 2026-07-25  
**Status:** Approved design  
**Target branch:** `docs/readme-handbook`, based on `origin/main`

## Purpose

Replace the sparse root README with a technical, lively handbook that helps a new reader understand DurinDoor, install it, send a request, connect a coding tool, and find deeper documentation without leaving the page to answer basic questions.

The README should match the clarity and energy of strong open-source project landing pages while staying accurate to DurinDoor. It must not copy upstream's long model catalogs, pricing claims, or other facts that become stale quickly.

## Goals

- Give DurinDoor a clear identity through existing banner and wordmark assets.
- Explain the product in one concrete value proposition.
- Guide readers from first impression through a working local request.
- Surface verified APIs, coding-tool integrations, routing, usage, multimodal, and compression features.
- Add restrained emoji to major headings and navigation.
- Keep detailed reference material in `docs/` and link to canonical pages.
- Make every local link, anchor, command, and asset machine-checkable.

## Non-goals

- Add a dashboard screenshot that does not exist in the repository.
- Duplicate dynamic provider or model catalogs in Markdown.
- Publish provider pricing, promotional credits, static counts, or unverified savings percentages.
- Add a language switcher; public project documentation remains English-only.
- Add adopter logos, videos, Trendshift badges, or other unsupported social proof.
- Change runtime behavior, package scripts, provider configuration, or model metadata.

## Audience and voice

The handbook serves three overlapping audiences:

1. Coding-tool users connecting Claude Code, Codex, Cursor, Cline, Roo Code, or Continue.
2. Application developers using OpenAI-, Anthropic-, or Responses-compatible endpoints.
3. Self-hosters evaluating installation, routing, security, usage, and operational behavior.

Use direct engineering prose. Keep paragraphs short, examples concrete, and claims source-backed. Emojis identify major sections; they do not decorate every list item. Avoid slogans, invented superlatives, and sales language.

## Information architecture

The README follows a journey-first structure:

1. **Hero**
   - Existing `assets/durindoor-banner.png`.
   - Existing theme-aware wordmark.
   - One-sentence value proposition.
   - Live project badges only: release, license, repository activity, or community links that resolve to DurinDoor-owned URLs.
2. **Quick navigation**
   - Compact links to Why, How it works, Quick start, Tools, Capabilities, API, Architecture, Security, and Contributing.
3. **🚪 Why DurinDoor**
   - State the problems it solves: one local gateway, multiple provider accounts, compatible APIs, routing/fallback, and usage visibility.
4. **🧭 How it works**
   - Reuse the existing architecture diagram.
   - Add a plain-text request-flow explanation for accessibility and readers who cannot render the image.
5. **⚡ Quick start**
   - Lead with one copy-paste installation path.
   - Show startup, dashboard URL, local API base URL, and one successful request.
   - Put npm, source, and version-pinned Docker alternatives in secondary subsections or collapsible blocks.
6. **🧩 Connect your tools**
   - Short cards or a compact table for Claude Code, Codex, Cursor, Cline, Roo Code, and Continue.
   - Link each tool to its canonical guide instead of duplicating full setup instructions.
7. **✨ Capabilities**
   - Group verified features into scannable tables: compatible request formats, account routing and fallback, usage and quota visibility, multimodal routes, MCP, and token-saving features.
8. **🔌 API surface**
   - Show one credential-neutral OpenAI-compatible request.
   - Summarize supported API families and link to `docs/reference/api.md`.
9. **🏗️ Architecture**
   - Explain translation through the OpenAI intermediate format, provider executors, streaming responses, and config-driven catalogs at a high level.
   - Link to `docs/ARCHITECTURE.md` for implementation detail.
10. **🔐 Security and operations**
    - Describe local deployment boundaries without overstating guarantees.
    - Link to canonical security, deployment, startup, and troubleshooting documents.
11. **📚 Documentation and community**
    - Link the documentation index, issue tracker, discussions or support channel when available, contribution guide, code of conduct, changelog, license, and upstream project.

Target length is 350–500 lines. This is a handbook, not a generated catalog.

## Content sources

README facts must come from current repository-owned sources:

- `package.json` for commands, package manager, engine versions, and scripts.
- `docs/getting-started/installation.md` and `docs/getting-started/quick-start.md` for installation and first-run instructions.
- `docs/integration/` for coding-tool setup links.
- `docs/reference/api.md` for endpoint families and request examples.
- `docs/ARCHITECTURE.md` for request flow and module boundaries.
- `docs/features/combos.md`, `docs/features/quota-tracking.md`, and `docs/features/smart-routing.md` for routing and usage behavior.
- `docs/features/compression.md` for token-saving features.
- `docs/features/mcp-gateway.md` for MCP coverage.
- `.github/SECURITY.md`, `docs/operations/security.md`, and deployment docs for security and operations.
- Repository assets under `assets/` and existing provider icons where they improve recognition.

Use the post-overhaul canonical feature paths above. Do not restore retired MCP or compression document links.

## Presentation rules

- Preserve centered hero assets and their light/dark behavior.
- Use one emoji per major heading at most.
- Prefer Markdown tables for short comparisons and bullet lists for explanations.
- Use `<details>` only for optional install variants or long examples.
- Add meaningful image alt text.
- Keep shell and API examples copy-pasteable.
- Use placeholders such as `$DURINDOOR_API_KEY`; never include real credentials or user data.
- Avoid exhaustive provider icons or model names. Link to live catalogs and provider docs instead.
- Keep heading text stable enough for local anchor links.

## Correctness and maintenance

Every claim must be traceable to `origin/main` source or a DurinDoor-owned live URL. Commands must use scripts that exist in `package.json`. Local links and anchors must resolve. Public URLs must follow repository documentation policy.

Volatile information stays config-driven. Future provider and model updates should change registries and generated catalogs, not force routine README edits.

README and model-catalog corrections remain separate changes. The README branch must not absorb the unrelated Anthropic, Claude Code, or GPT-5.6 metadata work.

## Verification

Run these checks after the README rewrite:

1. `npm run check:docs` to validate local targets, anchors, required assets, public-document reachability, and documented npm scripts.
2. A focused Markdown render inspection on GitHub-compatible output to confirm hero assets, tables, details blocks, heading anchors, and code fences display correctly.
3. A direct smoke check of the primary quick-start command and example request when the local runtime prerequisites are available.
4. `npx commitlint --from=origin/main --to=HEAD` before any push.

This is a documentation-only change, so it does not need a unit test. The existing documentation integrity checker and rendered/manual smoke checks cover its observable contract.

## Acceptance criteria

- Root README is 350–500 lines and follows the approved journey-first order.
- Existing banner and theme-aware wordmark remain visible.
- Major sections use restrained emoji and a compact navigation block.
- A new user can install DurinDoor, locate the dashboard and API base URL, and send one example request from the README.
- Claude Code, Codex, Cursor, Cline, Roo Code, and Continue link to canonical guides.
- API, routing, fallback, usage, multimodal, MCP, compression, architecture, security, operations, and contribution coverage use verified project facts.
- No unsupported counts, pricing, credits, savings claims, screenshots, adopters, or language switcher appear.
- No stale MCP link remains.
- Documentation integrity and commit-message checks pass.
