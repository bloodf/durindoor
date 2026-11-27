# Firefly consumer browser contract (#2034)

Research recorded 2026-11-27. This is a source review only: no Adobe account, browser session, provider endpoint, generation request, or sign-in was used. It supplements the bearer-token/source review in [`docs/providers/adobe-firefly.md`](../../docs/providers/adobe-firefly.md); it does not revise that page or assert live service behavior.

## Decision

Adobe's public consumer help documents actionable image and video workflows in Firefly's ordinary website: sign in, enter a prompt, choose a model/settings, select **Generate**, and access generated media through Generation history for preview/download. This is enough to establish that a consumer UI flow exists and to specify a guarded browser-adapter shape. It is not enough to implement reliable selectors or claim runnable parity: Adobe's help does not expose stable DOM/accessibility identifiers, a documented challenge stop-state, or job lifecycle/cancellation semantics.

Progress is therefore feasible as a **configurable guarded contract** under owner-operated sessions. An operator-supplied mapping may bind the documented semantic controls to the actual UI in that operator's environment. It must remain disabled until explicitly configured, must use an ordinary unmodified browser, and must stop for human action whenever identity, entitlement, consent, or challenge interaction is needed. Synthetic fixtures can validate our state machine; they do not demonstrate Adobe UI compatibility or live success.

## Primary-source evidence

The reviewed material is public first-party Adobe help and developer documentation. Page dates below are Adobe's displayed last-updated dates; pages without a displayed revision date are marked accordingly.

| Source and revision | Documented evidence | Boundary |
| --- | --- | --- |
| [Firefly workspace overview](https://helpx.adobe.com/firefly/web/get-started/access-the-app/firefly-workspace-overview.html), last updated 2026-11-10 | Says to visit Firefly and sign in with an Adobe account. Describes the Home prompt bar as accepting a prompt, reference image, generation type, model and settings. | Semantic workflow only; no labels, selectors, or auth automation instructions. |
| [Generate images using GPT Image](https://helpx.adobe.com/firefly/web/work-with-images/generate-images/generate-images-using-gpt-image.html), last updated 2026-06-16 | Steps say choose Generate → Generate image, enter text in the **Prompt** field, choose a model from **Model**, then select **Generate**. Partner-model use can show a confirmation dialog. | Concrete image flow and one documented consent interaction; not a selector contract. This page describes partner models, so model availability varies. |
| [Generate videos using text prompts](https://helpx.adobe.com/firefly/web/work-with-audio-and-video/work-with-video/generate-videos-using-text-prompts.html), last updated 2026-06-16 | Describes **Model** in General settings, the **Prompt** field, and **Generate**. Completed video appears in the history strip and can be downloaded; Generation History under Files stores generated media. | Concrete video flow; no semantic job states, cancellation, or expiry contract. |
| [View and manage generation history](https://helpx.adobe.com/firefly/web/access-your-files/view-generation-history.html), last updated 2026-11-10 | Generated image/audio/video is automatically saved under Files → Generation history. Context menu actions include **Preview**, **Download**, and **Delete permanently**. | Documents retrieval and deletion affordances, but not output URLs, identity of a particular in-flight job, or URL lifetime. |
| [Adobe Firefly FAQ](https://helpx.adobe.com/firefly/get-set-up/learn-the-basics/adobe-firefly-faq.pdf), PDF, published approximately 2025-08 per index metadata; no displayed revision date in extracted text | Identifies Firefly as a standalone web app at `firefly.adobe.com`, describes Adobe ID and active entitlement requirements, and says Firefly follows WCAG 2.1 AA best practices. | WCAG conformance is not a guarantee that specific accessible names/roles are stable or published. |
| [Firefly Services quickstart](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/), retrieved 2026-11-27; no revision date displayed | Documents API credentials and endpoints for Firefly Services. | Separate developer entitlement/API contract; no evidence of equivalence to a consumer Adobe account or consumer web flow. |

The cited help pages are primary documentation, not observed UI. Terms such as “Prompt field,” “Model dropdown,” and “Generate” are documented semantic labels. Any CSS selector, XPath, internal React identifier, or assumed accessible role/name would be an **inference** until an operator validates their own mapping. Adobe's WCAG statement supports trying role/name-based mappings but does not supply those names.

## Proven, inferred, unknown

| Status | Finding |
| --- | --- |
| Proven from primary docs | Consumer image and text-to-video workflows have prompt, model selection, a Generate action, and a history/download path. Sign-in is required to access the workspace. |
| Proven from existing local source | `open-sse/services/browserPool.js` is shared browser infrastructure, but its own header calls it a stealth pool and it prefers `cloakbrowser` fingerprint patches. It cannot be reused as-is for this work order. Gemini's executor also constructs context options separately. A dedicated ordinary Chromium path could reuse only neutral lifecycle/testing ideas, not identity/device emulation options or captured provider state. |
| Inferred, requiring operator validation | A mapping using accessible roles/names for prompt, model, Generate, history, preview/download may work against a given current UI. The documented human workflow makes this a reasonable implementation target, not a stable Adobe interface promise. |
| Unknown from public docs reviewed | Stable accessible identifiers; exact per-model UI differences; whether a generation can be cancelled after submission; observable pending/succeeded/failed states; job timeout/expiry; challenge, MFA, reauthentication, consent and entitlement UI details; download file naming/format and whether video download is directly exposed at completion or only from history. |
| Not established | No live success/failure, no service availability, no consumer API contract, and no guarantee that a given operator mapping will remain valid. |

## Minimal fail-closed contract to implement

This is an implementable boundary, not an existing provider or claim of live parity.

1. **Explicit guard and owner session.** No default provider registration or automatic account creation. Enable only by explicit operator configuration. A human signs in in a normal browser context and supplies/owns that context; never collect or export cookies, tokens, fingerprint material, risk metadata, or proof payloads. Keep browser storage isolated per configured account and never share a context across account keys.
2. **Unmodified browser.** Launch ordinary Playwright/Chromium with normal runtime defaults. Do not use cloakbrowser, stealth plugins, spoofed user-agent/client hints, injected fingerprints, anti-bot solvers, challenge bypass, or copied web-app request headers. Browser launch must fail closed if only a modified-browser mode is available.
3. **Operator mapping.** Require explicit selectors/locators for prompt, model (if requested), submit, observable completion/result, and download. Prefer role/name/label locators. Treat text inferred from help pages as defaults for operator confirmation only, never as verified selectors. A missing, ambiguous, detached, or multiply matched locator is a hard failure before submission.
4. **Human stop states.** Before submitting, and whenever sign-in, MFA, CAPTCHA/challenge, partner-model consent, entitlement, or unexpected confirmation appears, pause and surface a clear `needs_operator` state. Do not click through or retry around the state. Resume only after the operator resolves it in the same isolated context and explicitly continues.
5. **One submit, no uncertain replay.** Record a local request/job correlation before clicking once. If the click outcome or page response is ambiguous, return `outcome_unknown`; do not click again automatically. A retry requires operator resolution that no job was accepted. Never infer acceptance from a mock or from merely observing a button click.
6. **Bounded observation and result.** Apply overall and per-navigation deadlines. Require a mapped, unambiguous result-ready signal before reading output. Download only via the mapped user-facing Download action; validate that a file was produced, enforce size/type limits, and do not follow a page-provided arbitrary URL with account credentials. If no safe observable state is reached by deadline, return unknown outcome and stop.
7. **Cancellation and accounting.** If the caller disconnects after submit, stop waiting and close only this request's page; report `outcome_unknown` unless the UI provides a documented/validated cancellation action and its success is observed. Count usage only after an observed completed result; preserve unknown-outcome accounting separately so it cannot be silently treated as free or reissued. Separate account counters and contexts.

## Synthetic acceptance evidence

If implementation proceeds, fixtures must be clearly synthetic local pages and use injected fake browser/page objects; they cannot be described as Adobe success. Minimum tests:

- Guard off, missing mapping, malformed mapping, or ambiguous required locator fails before submit.
- Prompt/model selection and a single submit use only the configured semantic mapping; consent/challenge/login/entitlement fixtures transition to `needs_operator` without clicking through.
- Timeout, caller abort, navigation loss, and missing completion leave outcome unknown and never cause a second submit.
- A completed fixture downloads only through the configured UI action, validates the local artifact, and accounts once; failed or partial artifacts do not count as success.
- Two account keys use different browser contexts, storage state, pages and accounting; no cookies, local storage, or outputs cross accounts.
- Redirects or page content proposing arbitrary network fetches do not cause credential forwarding. No fixture asserts a live Adobe host, service response, challenge bypass, or successful generation.

The exact remaining evidence boundary is an operator-validated mapping for their current UI plus observed, owner-authorized behavior for any lifecycle semantics they want to expose (especially cancellation and completion). Public docs alone do not supply a stable selector set or those lifecycle guarantees. The separately documented Services API remains a distinct entitlement and must not be presented as consumer parity.

## Earlier pinned-source notes

The earlier revision-bound inventories are [`provider-parity-omniroute.md`](./provider-parity-omniroute.md) and [`provider-parity-cliproxyapi.md`](./provider-parity-cliproxyapi.md). They compare pinned source snapshots and do not establish consumer UI behavior. The provider page's OmniRoute notes describe HTTP request construction and credential capture. Their absence of a qualifying UI executor is a limit of those source snapshots, not evidence that Adobe lacks a consumer UI workflow and not a reason to invent an authorization barrier.
