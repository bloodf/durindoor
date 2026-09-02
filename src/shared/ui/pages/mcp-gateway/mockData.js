export const mcpInstances = [
  {
    id: "granola",
    slug: "granola",
    title: "Granola",
    kind: "http",
    transport: "http",
    auth: "OAuth",
    status: "Connected",
    enabled: true,
    url: "https://mcp.granola.ai/mcp",
  },
];

export const instanceKindOptions = [
  { value: "http", label: "HTTP" },
  { value: "sse", label: "SSE" },
  { value: "stdio", label: "Stdio" },
];
