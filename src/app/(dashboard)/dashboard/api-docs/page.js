import { Card } from "@/shared/components";

const ENDPOINTS = [
  "/api/v1/chat/completions", "/v1/messages", "/v1/models", "/v1/responses", "/v1/responses/compact",
  "/v1/images/generations", "/v1/audio/transcriptions", "/v1/audio/translations", "/v1/video/generations",
  "/v1/realtime/auth", "/api/models/availability", "/api/v1/provider-plugin-manifest",
];

export default function ApiDocsPage() {
  return <div className="space-y-6"><div><h1 className="text-xl font-semibold">API Documentation</h1><p className="text-sm text-text-muted">When Require API Key is enabled, send <code>Authorization: Bearer &lt;key&gt;</code>. Local-request exemptions follow the same policy as <code>/v1/models</code>.</p></div><Card><div className="grid gap-2">{ENDPOINTS.map((endpoint) => <code key={endpoint} className="rounded bg-surface-2 px-3 py-2">{endpoint}</code>)}</div></Card></div>;
}
