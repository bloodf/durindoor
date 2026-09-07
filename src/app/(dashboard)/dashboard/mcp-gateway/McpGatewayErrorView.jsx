import EmptyState from "@/shared/ui/components/EmptyState.jsx";

export default function McpGatewayErrorView({ reset }) {
  return <main className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center py-16 text-[13px]"><EmptyState icon="error" title="MCP Gateway failed to load" message="This usually happens during initial hydration or when the dashboard API is unreachable. Try again to reload the page." action={{ label: "Try again", icon: "refresh", onClick: () => reset() }} /><p className="mt-6 text-xs text-dd-subtle">If the error persists, the dashboard server logs may include more detail.</p></main>;
}
