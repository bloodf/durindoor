# Internal documentation

These references support AI coding agents and maintainers. The website does not publish this directory. Public user and operator guides live in [`docs/`](../../docs/index.mdx).

Start with [`AGENTS.md`](../../AGENTS.md) for the contributor contract. [`PRODUCT.md`](../../PRODUCT.md) records product scope and [`DESIGN.md`](../../DESIGN.md) records the implemented visual system. Use the reference that matches your task:

- [Full product implementation references](./product/README.md)
- [Revision-bound verification](./documentation-verification.md)
- [Rewrite coverage and source review](./project-review.md), [usage](./usage-review.md), [runtime](./runtime-review.md), and [reference](./reference-review.md)
- [AI implementation and porting workflow](./agent-workflow.md)
- [Development and verification](./index.mdx)
- [Architecture and request lifecycle](./architecture.mdx)
- [Port upstream features](./upstream-sync.mdx)
- [Provider registry](./provider-registry.mdx) and [translators](./translators.mdx)
- [Testing and regression gates](./testing.mdx)
- [Release procedures](./release-process.mdx)
- [Postgres schema migrations](./postgres-migrations.mdx)
- [Brand guide](./brand-guide.mdx), [dashboard design system](./design-system.mdx), and [provider asset policy](./provider-brand-assets.mdx)
- [Brand image prompts](./brand-prompts.md) and [provider audit evidence](./provider-expansion-audit.json)

Keep implementation details, source ownership, compatibility constraints, porting decisions, evidence limits, and validation procedures here. Keep public pages concise, with complete setup steps, supported behavior, limits, and recovery instructions. When behavior changes, update both audiences where relevant.

The site compiles MDX only from `docs/`. Moving a page here removes its public route and search entry. Do not add links to this directory from public docs or copy internal Markdown into `website/public/`.
