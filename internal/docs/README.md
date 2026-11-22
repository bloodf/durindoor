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
- [V5 admin design audit](./audits/v5-design-2026-10-29/README.md), including Visant findings, screenshots, preservation checks and verification limits
- [V5 production integration plan (#1300)](./v5-production-integration.md): acceptance status, scope, opt-in switch, surface checks and implementation slices
- [OmniRoute security-audit applicability (#1150)](./omniroute-security-audit-1150.md)
- [OmniRoute open-PR working notes (#1073)](./omniroute-open-prs-1073.md)
- [Claude Code sign-in comparison (#2034)](./claude-signin-parity-2034.md)
- [OpenCode Go DeepSeek effort tiers (#2034)](./opencode-go-effort-parity-2034.md)
- [Vertex AI service-account and ADC comparison (#2034)](./vertex-signin-parity-2034.md)
- [Copilot Web and Microsoft 365 Copilot Web cookie lifecycle (#2034)](./copilot-cookie-lifecycle-2034.md)
- [Provider cookie capture extension (#2034)](./provider-cookie-capture-extension-2034.md)
- [NoTrack developer API provider (#2034)](./notrack-2034.md)
- [Session capture storage and retention (#1131)](./session-capture-1131.md)

Keep implementation details, source ownership, compatibility constraints, porting decisions, evidence limits, and validation procedures here. Keep public pages concise, with complete setup steps, supported behavior, limits, and recovery instructions. When behavior changes, update both audiences where relevant.

The site compiles MDX only from `docs/`. Moving a page here removes its public route and search entry. Do not add links to this directory from public docs or copy internal Markdown into `website/public/`.

Vertex rejects malformed JSON-like credentials before dispatch or dashboard probing. Service-account token reuse is scoped to the complete credential and egress route. Partner API-key project discovery uses the selected transport and validates the derived project ID.
