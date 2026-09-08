# Durin DS execution plans

Plan-first deliverable for a full production web UI rewrite. 001 is the primary
deliverable: rewrite of the live app's routes, shell, navigation, styling and
shared/domain widgets. 002 is the subordinate Storybook validation workstream
that proves the same production surfaces, never a substitute for the rewrite.
Implementation has not started; no AAA or Playwright completion claimed.

| Plan | Role | Scope | Base | Status |
| --- | --- | --- | --- | --- |
| [001 — All-pages gauntlet](001-durin-ds-gauntlet.md) | Primary: production UI rewrite | 37 route templates, dynamic variants, 27 primitives, 21 mocks, 52 legacy shared modules, safe fixtures and objective quality repair loop | `cf572ec911` | PLANNED — implementation not started, execution gates unrun |
| [002 — Working Storybook coverage](002-storybook-coverage.md) | Support: story/browser validation | Every production component, page and widget; meaningful CSF3 states, isolated fixtures, complete built-index browser verification | `cf572ec911` | PLANNED — implementation not started, mandatory alongside 001, never sufficient alone |

Main checkout safely fast-forwarded; original 13 dirty files/index state preserved
in `.omc/wt-ui-preflight-recovery` plus private backup and retained stash. No existing
worktree met clean ancestral deletion gate; none removed. Preserve recovery tree.

Execution order: baseline/harness, accessible foundation, behavior-preserving
shell, independent page waves, integrated Playwright/design/accessibility loop,
post-proof cleanup and final acceptance. Every failed gate returns exact owning
lane to repair; no phase ending counts as project completion.

Storybook coverage is a per-surface acceptance gate, not a later optional pass.
Every migration supplies working production-import stories and real-app tests;
reference mocks alone cannot satisfy it.

Canonical background: [UI migration campaign](../docs/development/ui-migration/README.md).
Plan supersedes stale cleanup permissions: `src/app/globals.css` remains read-only;
active runtime shell adapters remain. Full human diff review required before push/PR.
