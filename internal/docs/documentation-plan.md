# Documentation rewrite acceptance

1. Public pages cover installation, configuration, use, deployment, operations, and API lookup with complete commands and stated limits.
2. AI references retain implementation details, source paths, compatibility decisions, porting procedures, brand rules, and verification requirements.
3. Internal references are absent from public routes, navigation, search, and copied assets.
4. Existing links resolve after relocation. Public pages cannot link to internal references.
5. Every public chapter is reviewed against repository source. Generated provider catalog content is regenerated, not hand edited.
6. Documentation checks, affected unit tests, the website build, browser checks, root lint, and the separate-package CI gate pass before merge.

Execution order: establish the publication boundary, rewrite chapters in independent groups, review the assembled documents, validate the built site, then merge and verify production.
