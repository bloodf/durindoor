import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";

const sections = [
  {
    title: "Chat & Completions",
    icon: "chat",
    description: "Generate text, reasoning, and tool calls through compatible client formats.",
    endpoints: [
      ["POST", "/api/v1/chat/completions", "OpenAI-compatible chat completions, streamed or single-shot."],
      ["POST", "/v1/messages", "Anthropic Messages API for Claude-compatible clients."],
      ["POST", "/v1/responses", "OpenAI Responses API with reasoning and tool calls."],
      ["POST", "/v1/responses/compact", "Compact Responses payloads for lower-bandwidth clients."],
    ],
  },
  {
    title: "Models",
    icon: "grid_view",
    description: "Discover models and current provider availability.",
    endpoints: [
      ["GET", "/v1/models", "List every model reachable through this gateway."],
      ["GET", "/api/models/availability", "Inspect provider availability and health for the model catalog."],
    ],
  },
  {
    title: "Images",
    icon: "image",
    description: "Create images using configured multimodal providers.",
    endpoints: [
      ["POST", "/v1/images/generations", "Generate one or more images from a text prompt."],
    ],
  },
  {
    title: "Audio",
    icon: "graphic_eq",
    description: "Transcribe, translate, and synthesize spoken audio.",
    endpoints: [
      ["POST", "/v1/audio/transcriptions", "Transcribe an audio file into text."],
      ["POST", "/v1/audio/translations", "Translate spoken audio into English text."],
      ["POST", "/v1/audio/speech", "Generate speech audio from text input."],
    ],
  },
  {
    title: "Video",
    icon: "movie",
    description: "Generate video through supported media providers.",
    endpoints: [
      ["POST", "/v1/video/generations", "Generate a video from a text prompt."],
    ],
  },
  {
    title: "Realtime",
    icon: "sensors",
    description: "Establish low-latency, bidirectional model sessions.",
    endpoints: [
      ["POST", "/v1/realtime/auth", "Mint a short-lived token for the realtime WebSocket."],
      ["GET", "/v1/realtime", "Open the authenticated realtime WebSocket connection."],
    ],
  },
];

function EndpointRow({ method, path, description }) {
  return (
    <li className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[3.75rem_minmax(12rem,0.8fr)_1fr] sm:items-center sm:gap-3">
      <Badge tone={method === "GET" ? "success" : "info"} size="sm" className="w-fit">
        {method}
      </Badge>
      <code className="w-fit break-all rounded-dd bg-dd-surface-2 px-2 py-1 font-mono text-xs text-dd-text">
        {path}
      </code>
      <span className="text-[13px] leading-5 text-dd-muted">{description}</span>
    </li>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader
        icon="description"
        title="API Documentation"
        subtitle="OpenAI, Anthropic, media, and realtime endpoint reference"
      />

      <Card className="flex items-start gap-3">
        <span className="material-symbols-outlined mt-0.5 text-[20px] text-dd-info" aria-hidden="true">
          info
        </span>
        <p className="text-[13px] leading-5 text-dd-muted">
          When API-key enforcement is enabled, send{" "}
          <code className="rounded bg-dd-surface-2 px-1.5 py-0.5 font-mono text-xs text-dd-text">
            Authorization: Bearer &lt;key&gt;
          </code>{" "}
          with each request. All endpoints use your DurinDoor host as the base URL.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.title} padding={false}>
            <CardHeader
              icon={section.icon}
              title={section.title}
              subtitle={section.description}
            />
            <CardContent>
              <ul className="divide-y divide-dd-border-subtle">
                {section.endpoints.map(([method, path, description]) => (
                  <EndpointRow
                    key={path}
                    method={method}
                    path={path}
                    description={description}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
