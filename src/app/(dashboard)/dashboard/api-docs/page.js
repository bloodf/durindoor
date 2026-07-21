/**
 * @file API documentation page — static, server-rendered.
 *
 * The single source of truth is the `ENDPOINTS` array below: each deployed
 * route is listed once, enriched with its HTTP method, category, and a
 * one-line purpose. The page derives grouped Cards from that array, so the
 * docs and the live API surface can never drift apart. Nothing is fetched
 * at request time.
 */
import { Card, Badge } from "@/shared/components";

/**
 * Auth note shown in the page header. Kept as a constant so the prose and
 * the curl example stay consistent.
 */
const AUTH_NOTE = (
  <>
    When <strong>Require API Key</strong> is enabled, send{" "}
    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
      Authorization: Bearer &lt;key&gt;
    </code>
    . Local-request exemptions follow the same policy as{" "}
    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
      /v1/models
    </code>
    .
  </>
);

/** Method badge colour by verb — green for safe reads, blue for writes. */
const METHOD_VARIANT = {
  GET: "success",
  POST: "info",
};

/**
 * Display order + icon for each category. Categories only declared here;
 * endpoints belong to a category via `ENDPOINTS[i].category`.
 */
const CATEGORY_ORDER = [
  { id: "chat", title: "Chat & Completions", icon: "chat" },
  { id: "models", title: "Models", icon: "grid_view" },
  { id: "images", title: "Images", icon: "image" },
  { id: "audio", title: "Audio", icon: "graphic_eq" },
  { id: "video", title: "Video", icon: "movie" },
  { id: "realtime", title: "Realtime", icon: "sensors" },
  { id: "meta", title: "Meta", icon: "extension" },
];

/**
 * Single source of truth: every deployed endpoint, enriched once.
 * `method` is the inferred verb (writes = POST, reads = GET); `desc` is a
 * single short sentence so the page stays scannable. Do not add an entry
 * without a matching live route, and do not duplicate a `path`.
 * @type {{ method: "GET"|"POST", path: string, category: string, desc: string }[]}
 */
const ENDPOINTS = [
  {
    method: "POST",
    path: "/api/v1/chat/completions",
    category: "chat",
    desc: "OpenAI-compatible chat completions (streaming or single-shot).",
  },
  {
    method: "POST",
    path: "/v1/messages",
    category: "chat",
    desc: "Anthropic-style Messages API for Claude-family models.",
  },
  {
    method: "POST",
    path: "/v1/responses",
    category: "chat",
    desc: "OpenAI Responses API (reasoning + tool calls).",
  },
  {
    method: "POST",
    path: "/v1/responses/compact",
    category: "chat",
    desc: "Compact Responses payload for lower-bandwidth clients.",
  },
  {
    method: "GET",
    path: "/v1/models",
    category: "models",
    desc: "List all models reachable through this gateway.",
  },
  {
    method: "GET",
    path: "/api/models/availability",
    category: "models",
    desc: "Per-provider availability and health for the model catalog.",
  },
  {
    method: "POST",
    path: "/v1/images/generations",
    category: "images",
    desc: "Generate images from a text prompt.",
  },
  {
    method: "POST",
    path: "/v1/audio/transcriptions",
    category: "audio",
    desc: "Transcribe an audio file to text.",
  },
  {
    method: "POST",
    path: "/v1/audio/translations",
    category: "audio",
    desc: "Translate audio into English text.",
  },
  {
    method: "POST",
    path: "/v1/video/generations",
    category: "video",
    desc: "Generate video from a text prompt.",
  },
  {
    method: "POST",
    path: "/v1/realtime/auth",
    category: "realtime",
    desc: "Mint a short-lived session token for the realtime WebSocket.",
  },
  {
    method: "GET",
    path: "/api/v1/provider-plugin-manifest",
    category: "meta",
    desc: "Machine-readable manifest of provider plugins.",
  },
];

/** Single curl example for the primary chat endpoint. */
const CHAT_COMPLETIONS_CURL = `curl https://YOUR-HOST/api/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'`;

/**
 * Derive grouped endpoint lists from `ENDPOINTS`, preserving category
 * display order. Empty categories are skipped so the page shows no empty
 * Cards. Duplicate paths in `ENDPOINTS` would render twice here, which is
 * the intended fail-loud signal at review time.
 * @returns {{ title: string, icon: string, endpoints: typeof ENDPOINTS }[]}
 */
function deriveGroups() {
  return CATEGORY_ORDER
    .map((cat) => ({
      title: cat.title,
      icon: cat.icon,
      endpoints: ENDPOINTS.filter((ep) => ep.category === cat.id),
    }))
    .filter((group) => group.endpoints.length > 0);
}

/**
 * One endpoint row: method badge, path chip, short description.
 * Kept as a component so the group renderer stays declarative.
 */
function EndpointRow({ method, path, desc }) {
  return (
    <li className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-3">
      <Badge variant={METHOD_VARIANT[method] ?? "default"} size="sm" className="w-fit shrink-0 uppercase tracking-wide">
        {method}
      </Badge>
      <code className="inline-block w-fit break-all rounded bg-surface-2 px-2 py-1 font-mono text-xs">
        {path}
      </code>
      <span className="text-sm text-text-muted sm:ml-1">{desc}</span>
    </li>
  );
}

/**
 * API documentation page.
 *
 * @returns {JSX.Element} Server-rendered API docs grouped by category.
 */
export default function ApiDocsPage() {
  const groups = deriveGroups();
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">API Documentation</h1>
        <p className="text-sm text-text-muted leading-relaxed">{AUTH_NOTE}</p>
      </div>

      <div className="grid gap-4">
        {groups.map((group) => (
          <Card key={group.title} padding="md">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <span className="material-symbols-outlined text-[20px] text-text-muted" aria-hidden="true">
                  {group.icon}
                </span>
                {group.title}
              </h2>
              <ul className="divide-y divide-border">
                {group.endpoints.map((ep) => (
                  <EndpointRow key={ep.path} {...ep} />
                ))}
              </ul>
            </div>
          </Card>
        ))}
      </div>

      <Card padding="md">
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <span className="material-symbols-outlined text-[20px] text-text-muted" aria-hidden="true">
              terminal
            </span>
            Example request
          </h2>
          <p className="text-sm text-text-muted">
            Minimal chat completion call using <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">curl</code>.
            Replace <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">YOUR-HOST</code> and{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">YOUR_API_KEY</code>.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 font-mono text-xs leading-relaxed text-text">
            <code>{CHAT_COMPLETIONS_CURL}</code>
          </pre>
        </div>
      </Card>
    </div>
  );
}
