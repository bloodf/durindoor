
import { isString } from "../../../src/shared/utils/typeChecks.js";
import { readNamedHeader } from "../../config/codexHeaders.js";

// Default instructions for Codex models

export const CODEX_DEFAULT_INSTRUCTIONS = `You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.

## General

- When searching for text or files, prefer using \`rg\` or \`rg --files\` respectively because \`rg\` is much faster than alternatives like \`grep\`. (If the \`rg\` command is not found, then use alternatives.)

## Editing constraints

- Default to ASCII when editing or creating files. Only introduce non-ASCII or other Unicode characters when there is a clear justification and the file already uses them.
- Add succinct code comments that explain what is going on if code is not self-explanatory. You should not add comments like "Assigns the value to the variable", but a brief comment might be useful ahead of a complex code block that the user would otherwise have to spend time parsing out. Usage of these comments should be rare.
- Try to use apply_patch for single file edits, but it is fine to explore other options to make the edit if it does not work well. Do not use apply_patch for changes that are auto-generated (i.e. generating package.json or running a lint or format command like gofmt) or when scripting is more efficient (such as search and replacing a string across a codebase).
- You may be in a dirty git worktree.
    * NEVER revert existing changes you did not make unless explicitly requested, since these changes were made by the user.
    * If asked to make a commit or code edits and there are unrelated changes to your work or changes that you didn't make in those files, don't revert those changes.
    * If the changes are in files you've touched recently, you should read carefully and understand how you can work with the changes rather than reverting them.
    * If the changes are in unrelated files, just ignore them and don't revert them.
- Do not amend a commit unless explicitly requested to do so.
- While you are working, you might notice unexpected changes that you didn't make. If this happens, STOP IMMEDIATELY and ask the user how they would like to proceed.
- **NEVER** use destructive commands like \`git reset --hard\` or \`git checkout --\` unless specifically requested or approved by the user.

## Plan tool

When using the planning tool:
- Skip using the planning tool for straightforward tasks (roughly the easiest 25%).
- Do not make single-step plans.
- When you made a plan, update it after having performed one of the sub-tasks that you shared on the plan.

## Codex CLI harness, sandboxing, and approvals

The Codex CLI harness supports several different configurations for sandboxing and escalation approvals that the user can choose from.

Filesystem sandboxing defines which files can be read or written. The options for \`sandbox_mode\` are:
- **read-only**: The sandbox only permits reading files.
- **workspace-write**: The sandbox permits reading files, and editing files in \`cwd\` and \`writable_roots\`. Editing files in other directories requires approval.
- **danger-full-access**: No filesystem sandboxing - all commands are permitted.

Network sandboxing defines whether network can be accessed without approval. Options for \`network_access\` are:
- **restricted**: Requires approval
- **enabled**: No approval needed

Approvals are your mechanism to get user consent to run shell commands without the sandbox. Possible configuration options for \`approval_policy\` are
- **untrusted**: The harness will escalate most commands for user approval, apart from a limited allowlist of safe "read" commands.
- **on-failure**: The harness will allow all commands to run in the sandbox (if enabled), and failures will be escalated to the user for approval to run again without the sandbox.
- **on-request**: Commands will be run in the sandbox by default, and you can specify in your tool call if you want to escalate a command to run without sandboxing. (Note that this mode is not always available. If it is, you'll see parameters for it in the \`shell\` command description.)
- **never**: This is a non-interactive mode where you may NEVER ask the user for approval to run commands. Instead, you must always persist and work around constraints to solve the task for the user. You MUST do your utmost best to finish the task and validate your work before yielding. If this mode is paired with \`danger-full-access\`, take advantage of it to deliver the best outcome for the user. Further, in this mode, your default testing philosophy is overridden: Even if you don't see local patterns for testing, you may add tests and scripts to validate your work. Just remove them before yielding.

When you are running with \`approval_policy == on-request\`, and sandboxing enabled, here are scenarios where you'll need to request approval:
- You need to run a command that writes to a directory that requires it (e.g. running tests that write to /var)
- You need to run a GUI app (e.g., open/xdg-open/osascript) to open browsers or files.
- You are running sandboxed and need to run a command that requires network access (e.g. installing packages)
- If you run a command that is important to solving the user's query, but it fails because of sandboxing, rerun the command with approval. ALWAYS proceed to use the \`sandbox_permissions\` and \`justification\` parameters - do not message the user before requesting approval for the command.
- You are about to take a potentially destructive action such as an \`rm\` or \`git reset\` that the user did not explicitly ask for
- (for all of these, you should weigh alternative paths that do not require approval)

When \`sandbox_mode\` is set to read-only, you'll need to request approval for any command that isn't a read.

You will be told what filesystem sandboxing, network sandboxing, and approval mode are active in a developer or user message. If you are not told about this, assume that you are running with workspace-write, network sandboxing enabled, and approval on-failure.

Although they introduce friction to the user because your work is paused until the user responds, you should leverage them when necessary to accomplish important work. If the completing the task requires escalated permissions, Do not let these settings or the sandbox deter you from attempting to accomplish the user's task unless it is set to "never", in which case never ask for approvals.

When requesting approval to execute a command that will require escalated privileges:
  - Provide the \`sandbox_permissions\` parameter with the value \`"require_escalated"\`
  - Include a short, 1 sentence explanation for why you need escalated permissions in the justification parameter

## Special user requests

- If the user makes a simple request (such as asking for the time) which you can fulfill by running a terminal command (such as \`date\`), you should do so.
- If the user asks for a "review", default to a code review mindset: prioritise identifying bugs, risks, behavioural regressions, and missing tests. Findings must be the primary focus of the response - keep summaries or overviews brief and only after enumerating the issues. Present findings first (ordered by severity with file/line references), follow with open questions or assumptions, and offer a change-summary only as a secondary detail. If no findings are discovered, state that explicitly and mention any residual risks or testing gaps.

## Frontend tasks
When doing frontend design tasks, avoid collapsing into "AI slop" or safe, average-looking layouts.
Aim for interfaces that feel intentional, bold, and a bit surprising.
- Typography: Use expressive, purposeful fonts and avoid default stacks (Inter, Roboto, Arial, system).
- Color & Look: Choose a clear visual direction; define CSS variables; avoid purple-on-white defaults. No purple bias or dark mode bias.
- Motion: Use a few meaningful animations (page-load, staggered reveals) instead of generic micro-motions.
- Background: Don't rely on flat, single-color backgrounds; use gradients, shapes, or subtle patterns to build atmosphere.
- Overall: Avoid boilerplate layouts and interchangeable UI patterns. Vary themes, type families, and visual languages across outputs.
- Ensure the page loads properly on both desktop and mobile

Exception: If working within an existing website or design system, preserve the established patterns, structure, and visual language.

## Presenting your work and final message

You are producing plain text that will later be styled by the CLI. Follow these rules exactly. Formatting should make results easy to scan, but not feel mechanical. Use judgment to decide how much structure adds value.

- Default: be very concise; friendly coding teammate tone.
- Ask only when needed; suggest ideas; mirror the user's style.
- For substantial work, summarize clearly; follow final‑answer formatting.
- Skip heavy formatting for simple confirmations.
- Don't dump large files you've written; reference paths only.
- No "save/copy this file" - User is on the same machine.
- Offer logical next steps (tests, commits, build) briefly; add verify steps if you couldn't do something.
- For code changes:
  * Lead with a quick explanation of the change, and then give more details on the context covering where and why a change was made. Do not start this explanation with "summary", just jump right in.
  * If there are natural next steps the user may want to take, suggest them at the end of your response. Do not make suggestions if there are no natural next steps.
  * When suggesting multiple options, use numeric lists for the suggestions so the user can quickly respond with a single number.
- The user does not command execution outputs. When asked to show the output of a command (e.g. \`git show\`), relay the important details in your answer or summarize the key lines so the user understands the result.

### Final answer structure and style guidelines

- Plain text; CLI handles styling. Use structure only when it helps scanability.
- Headers: optional; short Title Case (1-3 words) wrapped in **…**; no blank line before the first bullet; add only if they truly help.
- Bullets: use - ; merge related points; keep to one line when possible; 4–6 per list ordered by importance; keep phrasing consistent.
- Monospace: backticks for commands/paths/env vars/code ids and inline examples; use for literal keyword bullets; never combine with **.
- Code samples or multi-line snippets should be wrapped in fenced code blocks; include an info string as often as possible.
- Structure: group related bullets; order sections general → specific → supporting; for subsections, start with a bolded keyword bullet, then items; match complexity to the task.
- Tone: collaborative, concise, factual; present tense, active voice; self‑contained; no "above/below"; parallel wording.
- Don'ts: no nested bullets/hierarchies; no ANSI codes; don't cram unrelated keywords; keep keyword lists short—wrap/reformat if long; avoid naming formatting styles in answers.
- Adaptation: code explanations → precise, structured with code refs; simple tasks → lead with outcome; big changes → logical walkthrough + rationale + next actions; casual one-offs → plain sentences, no headers/bullets.
- File References: When referencing files in your response follow the below rules:
  * Use inline code to make file paths clickable.
  * Each reference should have a stand alone path. Even if it's the same file.
  * Accepted: absolute, workspace‑relative, a/ or b/ diff prefixes, or bare filename/suffix.
  * Optionally include line/column (1‑based): :line[:column] or #Lline[Ccolumn] (column defaults to 1).
  * Do not use URIs like file://, vscode://, or https://.
  * Do not provide range of lines
  * Examples: src/app.ts, src/app.ts:42, b/server/index.js#L10, C:\\repo\\project\\main.rs:12:5`;

// Codex CLI version OpenAI's backend sees. It gates model catalog entries and
// must stay current with the published @openai/codex release.
export const CODEX_CLI_VERSION = "0.167.1";

const SAFE_HEADER_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const CODEX_UA_VERSION_PATTERN = /(?:codex[-_][A-Za-z0-9_]*|codex-cli)\/(\d+\.\d+\.\d+)/i;

/**
 * Resolve the caller's Codex CLI version from the inbound `Version` header
 * (case-insensitive) or, failing that, a `codex_cli_rs/x.y.z`-shaped
 * `User-Agent`. Returns `null` when neither yields a usable version, so the
 * caller can fall back to the pinned default.
 *
 * @param {Headers|Record<string,string>|null} clientHeaders Inbound request headers.
 * @returns {string|null} Caller-reported Codex CLI version, or `null`.
 */
export function getCodexClientVersionFromHeaders(clientHeaders) {
  const versionHeader = readNamedHeader(clientHeaders, "version");
  if (versionHeader && SAFE_HEADER_TOKEN_PATTERN.test(versionHeader)) return versionHeader;
  const userAgent = readNamedHeader(clientHeaders, "user-agent");
  const match = userAgent.match(CODEX_UA_VERSION_PATTERN);
  return match ? match[1] : null;
}

function compareVersionParts(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Whether our advertised Codex CLI version satisfies a model catalog entry's
 * `minimal_client_version` gate. A missing/non-string gate always passes.
 * Upstream provenance: diegosouzapw/OmniRoute d5452d03e (#12933).
 *
 * @param {unknown} minimalClientVersion Catalog entry's `minimal_client_version` field.
 * @returns {boolean} `true` when CODEX_CLI_VERSION is new enough (or the gate is absent).
 */
export function meetsMinimalCodexClientVersion(minimalClientVersion) {
  if (!isString(minimalClientVersion) || !minimalClientVersion) return true;
  return compareVersionParts(CODEX_CLI_VERSION, minimalClientVersion) >= 0;
}

export default {
  id: "codex",
  priority: 30,
  alias: "cx",
  uiAlias: "cx",
  display: {
    name: "OpenAI Codex",
    icon: "code",
    color: "#3B82F6",
    website: "https://chatgpt.com/codex",
    notice: {
      signupUrl: "https://chatgpt.com/codex",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
    kindNotice: {
      stt: "Uses the same Codex OAuth connection as chat, not an OpenAI API key. Requires ffmpeg on the server; maximum 25 MiB and 120 seconds. Returns json or text only; language, prompt and timestamps are unsupported. This internal ChatGPT endpoint may change without notice.",
      image: "Requires a ChatGPT Plus (or higher) account. Free accounts are not supported for image generation.",
    },
  },
  modelProviderName: "OpenAI",
  category: "oauth",
  thinkingConfig: {
    options: [
      "auto",
      "none",
      "low",
      "medium",
      "high",
    ],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://chatgpt.com/backend-api/codex/responses",
    format: "openai-responses",
    forceStream: true,
    cliVersion: CODEX_CLI_VERSION,
    headers: {
      originator: "codex_cli_rs",
      "User-Agent": `codex_cli_rs/${CODEX_CLI_VERSION}`,
    },
    // Official openai/codex: semantic Ultra serializes as Max for requests.
    // Upstream provenance: decolua/9router#2523 — alias lookup is case-sensitive
    // ("ULTRA" must not map to "max").
    quirks: {
      reasoningEffortAliases: { ultra: "max" },
      // Chat accepts the Responses `prompt_cache_key` extension after lowering.
      preservePromptCacheKey: true,
    },
    usage: {
      url: "https://chatgpt.com/backend-api/wham/usage",
      modelsUrl: "https://chatgpt.com/backend-api/codex/models",
      clientVersion: CODEX_CLI_VERSION,
      resetCreditsUrl: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
      resetCreditsConsumeUrl: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume",
    },
  },
  models: [
    { id: "gpt-6.2-sol", name: "GPT 6.2 Sol", responsesLite: true, ultrafast: true },
    { id: "gpt-6.2-astra", name: "GPT 6.2 Astra", responsesLite: true },
    { id: "gpt-6-astra", name: "GPT 6 Astra" },
    { id: "gpt-6.1-sol", name: "GPT 6.1 Sol" },
    { id: "gpt-6.1-terra", name: "GPT 6.1 Terra" },
    { id: "gpt-6.1-terra-ultra", name: "GPT 6.1 Terra (Ultra)" },
    { id: "gpt-6.1-terra-max", name: "GPT 6.1 Terra (Max)" },
    { id: "gpt-6.1-terra-xhigh", name: "GPT 6.1 Terra (xHigh)", timeoutMs: 1_200_000 },
    { id: "gpt-6.1-terra-high", name: "GPT 6.1 Terra (High)", timeoutMs: 1_200_000 },
    { id: "gpt-6.1-terra-medium", name: "GPT 6.1 Terra (Medium)" },
    { id: "gpt-6.1-terra-low", name: "GPT 6.1 Terra (Low)" },
    { id: "gpt-6-sol", name: "GPT 6 Sol" },
    { id: "gpt-6-luna", name: "GPT 6 Luna" },
    // gpt-5.5 / gpt-5.5-review / gpt-5.5-image removed: retired for Codex with ChatGPT sign-in on
    // 2026-10-14 (HTTP 400). Saved configs get a 410 with a replacement from modelLifecycle.js.
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "gpt-5.4-review", name: "GPT 5.4 Review", upstreamModelId: "gpt-5.4", quotaFamily: "review" },
    // Upstream #865: named effort choices and their review quota aliases.
    ...["xhigh", "high", "medium", "low"].flatMap((effort) => [
      { id: `gpt-5.4-${effort}`, name: `GPT 5.4 (${effort})` },
      { id: `gpt-5.4-${effort}-review`, name: `GPT 5.4 (${effort}) Review`, upstreamModelId: `gpt-5.4-${effort}`, quotaFamily: "review" },
    ]),
    { id: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
    /** Live Codex catalog 2026-08-13 exposes this dedicated automatic-review base model. */
    { id: "codex-auto-review", name: "Codex Auto Review", quotaFamily: "review" },
    { id: "gpt-5.4-mini-review", name: "GPT 5.4 Mini Review", upstreamModelId: "gpt-5.4-mini", quotaFamily: "review" },
    { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    { id: "gpt-5.3-codex-review", name: "GPT 5.3 Codex Review", upstreamModelId: "gpt-5.3-codex", quotaFamily: "review" },
    { id: "gpt-5.3-codex-xhigh", name: "GPT 5.3 Codex (xHigh)" },
    { id: "gpt-5.3-codex-xhigh-review", name: "GPT 5.3 Codex (xHigh) Review", upstreamModelId: "gpt-5.3-codex-xhigh", quotaFamily: "review" },
    { id: "gpt-5.3-codex-high", name: "GPT 5.3 Codex (High)" },
    { id: "gpt-5.3-codex-high-review", name: "GPT 5.3 Codex (High) Review", upstreamModelId: "gpt-5.3-codex-high", quotaFamily: "review" },
    { id: "gpt-5.3-codex-low", name: "GPT 5.3 Codex (Low)" },
    { id: "gpt-5.3-codex-low-review", name: "GPT 5.3 Codex (Low) Review", upstreamModelId: "gpt-5.3-codex-low", quotaFamily: "review" },
    { id: "gpt-5.3-codex-none", name: "GPT 5.3 Codex (None)" },
    { id: "gpt-5.3-codex-none-review", name: "GPT 5.3 Codex (None) Review", upstreamModelId: "gpt-5.3-codex-none", quotaFamily: "review" },
    { id: "gpt-5.3-codex-spark", name: "GPT 5.3 Codex Spark" },
    { id: "gpt-5.3-codex-spark-review", name: "GPT 5.3 Codex Spark Review", upstreamModelId: "gpt-5.3-codex-spark", quotaFamily: "review" },
    { id: "gpt-image-2.5", name: "GPT Image 2.5", capabilities: ["text2img","edit","multiImage"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-image-2.5-flare", name: "GPT Image 2.5 Flare", capabilities: ["text2img","edit","multiImage"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", capabilities: ["text2img","edit","multiImage"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-image-2.6-flare", name: "GPT Image 2.6 Flare", capabilities: ["text2img","edit","multiImage"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-image-2.6-sunburst", name: "GPT Image 2.6 Sunburst", capabilities: ["text2img","edit","multiImage"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-6-sol-image", name: "GPT 6 Sol Image", capabilities: ["text2img","edit"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-5.6-sol-image", name: "GPT 5.6 Sol Image", capabilities: ["text2img","edit"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-5.6-terra-image", name: "GPT 5.6 Terra Image", capabilities: ["text2img","edit"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-5.6-luna-image", name: "GPT 5.6 Luna Image", capabilities: ["text2img","edit"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-5.4-image", name: "GPT 5.4 Image", capabilities: ["text2img","edit"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "gpt-5.3-image", name: "GPT 5.3 Image", capabilities: ["text2img","edit"], params: ["size","quality","background","image_detail","output_format"], kind: "image" },
    { id: "transcribe", name: "Codex Transcription", kind: "stt", params: ["response_format"], responseFormats: ["json", "text"] },
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
    { id: "gpt-5.6-sol-review", name: "GPT 5.6 Sol Review", upstreamModelId: "gpt-5.6-sol", quotaFamily: "review" },
    { id: "gpt-5.6-terra", name: "GPT 5.6 Terra" },
    { id: "gpt-5.6-terra-review", name: "GPT 5.6 Terra Review", upstreamModelId: "gpt-5.6-terra", quotaFamily: "review" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
    { id: "gpt-5.6-luna-review", name: "GPT 5.6 Luna Review", upstreamModelId: "gpt-5.6-luna", quotaFamily: "review" },
  ],
  serviceKinds: ["llm","image","stt"],
  // Fixed ChatGPT endpoint; reuses the Codex OAuth connection. Unverified live.
  sttConfig: {
    baseUrl: "https://chatgpt.com/backend-api/transcribe",
    authType: "oauth",
    format: "codex-transcribe",
  },
  oauth: {
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/api/accounts/oauth/token",
    scope: "openid profile email offline_access",
    codeChallengeMethod: "S256",
    fixedPort: 1455,
    callbackPath: "/auth/callback",
    // Headless sign-in (device flow). Upstream provenance:
    // router-for-me/CLIProxyAPI `sdk/auth/codex_device.go` at
    // 6faa8d20b2673404cff70a2f2d9537ae0d0e684d — the Codex device flow asks
    // auth.openai.com for a user code, polls for an authorization code plus the
    // server-issued PKCE pair, and exchanges that code with the device redirect.
    deviceCodeUrl: "https://auth.openai.com/api/accounts/deviceauth/usercode",
    deviceTokenUrl: "https://auth.openai.com/api/accounts/deviceauth/token",
    deviceVerificationUrl: "https://auth.openai.com/codex/device",
    deviceRedirectUri: "https://auth.openai.com/deviceauth/callback",
    extraParams: {
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "codex_cli_rs",
    },
    refreshLeadMs: 432000000,
    refresh: {
      encoding: "form",
      scope: "openid profile email offline_access",
    },
    maxRefreshAgeMs: 691200000,
    trackRefreshAt: true,
  },
  features: {
    usage: true,
  },
};
