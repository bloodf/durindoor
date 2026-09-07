import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card, CardContent } from "@/shared/ui/components/Card.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";

const METHOD_TONE = { GET: "success", POST: "info" };
const CATEGORY_ORDER = [
  { id: "chat", title: "Chat & Completions", icon: "chat" },
  { id: "models", title: "Models", icon: "grid_view" },
  { id: "images", title: "Images", icon: "image" },
  { id: "audio", title: "Audio", icon: "graphic_eq" },
  { id: "video", title: "Video", icon: "movie" },
  { id: "realtime", title: "Realtime", icon: "sensors" },
  { id: "meta", title: "Meta", icon: "extension" },
];
const ENDPOINTS = [
  ["POST", "/api/v1/chat/completions", "chat", "OpenAI-compatible chat completions (streaming or single-shot)."],
  ["POST", "/v1/messages", "chat", "Anthropic-style Messages API for Claude-family models."],
  ["POST", "/v1/responses", "chat", "OpenAI Responses API (reasoning + tool calls)."],
  ["POST", "/v1/responses/compact", "chat", "Compact Responses payload for lower-bandwidth clients."],
  ["GET", "/v1/models", "models", "List all models reachable through this gateway."],
  ["GET", "/api/models/availability", "models", "Per-provider availability and health for the model catalog."],
  ["POST", "/v1/images/generations", "images", "Generate images from a text prompt."],
  ["POST", "/v1/audio/transcriptions", "audio", "Transcribe an audio file to text."],
  ["POST", "/v1/audio/translations", "audio", "Translate audio into English text."],
  ["POST", "/v1/video/generations", "video", "Generate video from a text prompt."],
  ["POST", "/v1/realtime/auth", "realtime", "Mint a short-lived session token for the realtime WebSocket."],
  ["GET", "/api/v1/provider-plugin-manifest", "meta", "Machine-readable manifest of provider plugins."],
];
const CHAT_COMPLETIONS_CURL = `curl https://YOUR-HOST/api/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "model": "gpt-4o", "messages": [{ "role": "user", "content": "Hello!" }] }'`;

function InlineCode({ children }) {
  return <code className="rounded-dd bg-dd-surface-2 px-1.5 py-0.5 font-mono text-xs text-dd-text">{children}</code>;
}
function CategoryHeader({ title, icon, count }) {
  return <div className="flex items-center gap-3 border-b border-dd-border-subtle px-5 py-4">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
      <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">{icon}</span>
    </span>
    <h2 className="min-w-0 flex-1 text-sm font-semibold text-dd-text">{title}</h2>
    <span className="text-xs text-dd-subtle">{count} endpoint{count === 1 ? "" : "s"}</span>
  </div>;
}
function EndpointRow({ endpoint: [method, path, , description] }) {
  return <li className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[4rem_minmax(12rem,0.8fr)_1fr] sm:items-center sm:gap-3">
    <Badge tone={METHOD_TONE[method]} size="sm" className="w-fit uppercase">{method}</Badge>
    <InlineCode>{path}</InlineCode>
    <span className="text-[13px] leading-5 text-dd-muted">{description}</span>
  </li>;
}

export default function ApiDocsPage() {
  const groups = CATEGORY_ORDER
    .map((category) => ({ ...category, endpoints: ENDPOINTS.filter((endpoint) => endpoint[2] === category.id) }))
    .filter(({ endpoints }) => endpoints.length);
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
    <PageHeader
      icon="api"
      title="API Documentation"
      subtitle={<>When <strong className="text-dd-text">Require API Key</strong> is enabled, send <InlineCode>Authorization: Bearer &lt;key&gt;</InlineCode>. Local-request exemptions follow <InlineCode>/v1/models</InlineCode>.</>}
    />
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((group) => (
        <Card key={group.id} padding={false}>
          <CategoryHeader title={group.title} icon={group.icon} count={group.endpoints.length} />
          <CardContent>
            <ul className="divide-y divide-dd-border-subtle">
              {group.endpoints.map((endpoint) => <EndpointRow key={endpoint[1]} endpoint={endpoint} />)}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
    <Card padding={false}>
      <div className="flex items-center gap-3 border-b border-dd-border-subtle px-5 py-4">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">terminal</span>
        </span>
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-dd-text">Example request</h2>
      </div>
      <CardContent className="space-y-3 text-[13px] leading-5 text-dd-muted">
        <p>Replace <InlineCode>YOUR-HOST</InlineCode> and <InlineCode>YOUR_API_KEY</InlineCode>.</p>
        <pre tabIndex={0} aria-label="Example request" className="overflow-x-auto rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-4 font-mono text-xs leading-5 text-dd-text" role="region"><code>{CHAT_COMPLETIONS_CURL}</code></pre>
      </CardContent>
    </Card>
  </div>;
}
