# DurinDoor README Handbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the root README into a 350–500 line, journey-first handbook that is lively, accurate, and sufficient for a new user to reach a working DurinDoor request.

**Architecture:** Keep all volatile provider and model detail in the existing config-driven catalogs and canonical `docs/` pages. Rewrite only `README.md`, reusing existing brand assets, the documented request lifecycle, and checked local links. The root README becomes the onboarding path; deeper operational and API detail remains in linked documents.

**Tech Stack:** GitHub-flavored Markdown, HTML image/details elements, Mermaid, existing Node.js documentation checker.

## Global Constraints

- Work on `docs/readme-handbook`, based on current `origin/main`; never edit the dirty primary checkout.
- Preserve `assets/durindoor-banner.png` and `assets/durindoor-wordmark-theme-aware.svg` with meaningful alt text.
- Use direct technical prose and restrained emoji on major headings only.
- Keep `README.md` between 350 and 500 lines.
- Do not add dependencies, scripts, runtime behavior, screenshots, generated catalogs, pricing, provider credits, model/provider counts, adopter claims, savings percentages, or a language switcher.
- Use only repository-backed facts and canonical post-overhaul docs paths.
- Keep credential examples synthetic: `YOUR_DURINDOOR_API_KEY`, `MODEL_ID`, or environment-variable placeholders.
- Documentation-only change: do not add a unit test; `npm run check:docs` is the executable contract.

---

### Task 1: Rewrite the root README as a project handbook

**Files:**
- Modify: `README.md:1-76`
- Reference: `docs/getting-started/quick-start.md`
- Reference: `docs/getting-started/installation.md`
- Reference: `docs/guides/usage.md`
- Reference: `docs/reference/api.md`
- Reference: `docs/ARCHITECTURE.md`
- Reference: `docs/features/combos.md`
- Reference: `docs/features/smart-routing.md`
- Reference: `docs/features/quota-tracking.md`
- Reference: `docs/features/compression.md`
- Reference: `docs/features/mcp-gateway.md`
- Reference: `docs/operations/security.md`
- Test: `scripts/check-docs.mjs`

**Interfaces:**
- Consumes: repository-owned Markdown pages and assets on `origin/main`.
- Produces: root `README.md`, the public journey from project overview to first request and deeper documentation.

- [ ] **Step 1: Confirm the current documentation baseline**

Run:

```bash
npm run check:docs
```

Expected: `Documentation integrity checks passed.`

- [ ] **Step 2: Replace `README.md` with the approved journey-first structure**

Keep the existing centered banner and wordmark, then write these headings in this exact order so navigation anchors remain predictable:

```markdown
## 🗺️ Explore
## 🚪 Why DurinDoor?
## 🧭 How it works
## ⚡ Quick start
## 🧩 Connect your tools
## ✨ What DurinDoor handles
## 🔌 API surface
## 🏗️ Architecture
## 🔐 Security and operations
## 📚 Documentation
## 🤝 Contributing
## 🙏 Acknowledgments
```

Required content under those headings:

- **Hero:** keep npm, license, stars, and CI badges; center the badges and a concrete one-sentence value proposition.
- **Explore:** compact anchor navigation to every major section.
- **Why:** explain one local endpoint, reusable provider connections, account/combo fallback, format translation, usage visibility, and self-hosted state.
- **How it works:** include one Mermaid flow from client to DurinDoor routing/translation to provider, plus a four-step plain-text explanation.
- **Quick start:** document Node.js 20.20.2/npm 10.8.2 requirements, `npm install -g durindoor`, `durindoor`, dashboard/API/health URLs, provider/key creation, and one `/v1/chat/completions` request using `MODEL_ID` and `YOUR_DURINDOOR_API_KEY`.
- **Install alternatives:** use `<details>` blocks for `npx`, source, and Docker; pin the shown production image to `ghcr.io/bloodf/durindoor:3.9.0` and link upgrading guidance rather than promising `latest` stability.
- **Tools:** link Claude Code, Codex, Cursor, Cline, Roo Code, Continue, Ollama + Claude Code, and other OpenAI-compatible clients to their current `docs/integration/` pages.
- **Capabilities:** use scannable tables covering compatible API families, provider/account routing, combos, usage/quota visibility, compression, MCP, realtime, images/audio/embeddings, web search/fetch, and local/custom providers. Qualify modality support as provider-dependent.
- **API:** show the OpenAI-compatible base URL and summarize Chat Completions, Responses, Claude Messages, models, embeddings, images, audio, search/fetch, realtime, rerank, moderation, and token counting with links to `docs/reference/api.md`.
- **Architecture:** summarize dashboard routes, compatibility API, routing layer, `open-sse`, SQLite, account fallback, combo fallback, and OpenAI-pivot translation. Link `docs/ARCHITECTURE.md` for internals.
- **Security:** state localhost-first deployment, separate DurinDoor keys from upstream credentials, set explicit production secrets, use HTTPS/restrict dashboard access, back up `DATA_DIR`, and review security docs before exposure. Preserve compatibility notes for `~/.9router`, supported legacy API-key shapes, and `X-9Router-*` headers.
- **Documentation/community:** link the docs index, quick start, installation, usage, provider docs, API reference, operations, troubleshooting, FAQ, security policy, contribution guides, code of conduct, changelog, license, issue tracker, and discussions.
- **Acknowledgments:** retain 9router and decolua attribution without presenting upstream documentation or branding as DurinDoor's source of truth.

Do not include any of these strings or concepts as factual claims:

```text
provider count
model count
credits
free credits
save 90%
Trendshift
trusted by
language selector
```

- [ ] **Step 3: Check handbook size and structural coverage**

Run:

```bash
wc -l README.md
```

Expected: line count between `350` and `500`.

Run:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('README.md','utf8');const h=['## 🗺️ Explore','## 🚪 Why DurinDoor?','## 🧭 How it works','## ⚡ Quick start','## 🧩 Connect your tools','## ✨ What DurinDoor handles','## 🔌 API surface','## 🏗️ Architecture','## 🔐 Security and operations','## 📚 Documentation','## 🤝 Contributing','## 🙏 Acknowledgments'];const p=h.map(x=>s.indexOf(x));if(p.some(x=>x<0)||p.some((x,i)=>i&&x<=p[i-1]))process.exit(1);console.log('README section order passed.');"
```

Expected: `README section order passed.`

- [ ] **Step 4: Validate links, anchors, assets, and documented scripts**

Run:

```bash
npm run check:docs
```

Expected: `Documentation integrity checks passed.`

- [ ] **Step 5: Render and inspect the handbook**

Run:

```bash
npx marked README.md -o /tmp/durindoor-readme-handbook.html
```

Open `file:///tmp/durindoor-readme-handbook.html` in Chromium. Confirm:

- banner and theme-aware wordmark render;
- emoji headings and navigation are readable;
- Mermaid source remains a fenced block for GitHub rendering;
- tables do not contain malformed rows;
- all `<details>` blocks have visible summaries and balanced tags;
- shell and JSON code fences render as separate blocks;
- no raw Markdown or broken HTML leaks into rendered prose.

- [ ] **Step 6: Review the final diff for unsupported claims**

Run:

```bash
git diff --check
git diff -- README.md
```

Expected: no whitespace errors; diff touches only the intended README content after the already committed spec and plan.

- [ ] **Step 7: Commit the handbook**

Run:

```bash
git add README.md
git commit -m "docs(readme): revamp project handbook"
npx commitlint --from=origin/main --to=HEAD
```

Expected: commit succeeds and commitlint exits `0`.
