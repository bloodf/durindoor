// MCP gateway seed data: upstream instances, the tools each one exposes, and
// gateway keys with their instance grants.
import { DAY_MS, HOUR_MS, MACHINE_ID, isoAgo } from "../world.js";

export const MCP_INSTANCES = Object.freeze([
  {
    id: "mcp-github", slug: "github", title: "GitHub (Erebor org)", kind: "http", transport: "http",
    url: "https://api.githubcopilot.com/mcp/", command: null, args: [], oauth: false, enabled: true,
    createdAt: isoAgo(21 * DAY_MS), updatedAt: isoAgo(2 * DAY_MS),
  },
  {
    id: "mcp-filesystem", slug: "filesystem", title: "Forge workspace files", kind: "npx", transport: "stdio",
    url: null, command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/srv/forge/workspace"],
    oauth: false, enabled: true, createdAt: isoAgo(14 * DAY_MS), updatedAt: isoAgo(14 * DAY_MS),
  },
  {
    id: "mcp-linear", slug: "linear", title: "Linear (Erebor)", kind: "http", transport: "sse",
    url: "https://mcp.linear.app/sse", command: null, args: [], oauth: true, enabled: true,
    createdAt: isoAgo(5 * DAY_MS), updatedAt: isoAgo(6 * HOUR_MS), oauthConnected: false,
  },
]);

// Tools returned by the instance "test" probe, keyed by slug.
export const MCP_TOOLS = Object.freeze({
  github: [
    { name: "search_repositories", description: "Search GitHub repositories" },
    { name: "get_file_contents", description: "Read a file or directory from a repository" },
    { name: "list_pull_requests", description: "List pull requests in a repository" },
    { name: "create_pull_request", description: "Open a new pull request" },
    { name: "add_issue_comment", description: "Comment on an issue or pull request" },
    { name: "list_commits", description: "List commits on a branch" },
    { name: "get_workflow_run", description: "Inspect a GitHub Actions run" },
    { name: "search_code", description: "Search code across repositories" },
  ],
  filesystem: [
    { name: "read_text_file", description: "Read a text file from an allowed directory" },
    { name: "write_file", description: "Create or overwrite a file" },
    { name: "edit_file", description: "Apply line-based edits to a file" },
    { name: "list_directory", description: "List entries in a directory" },
    { name: "directory_tree", description: "Recursive tree view of a directory" },
    { name: "search_files", description: "Find files matching a pattern" },
  ],
  linear: [
    { name: "list_issues", description: "List issues assigned to a team or user" },
    { name: "create_issue", description: "Create a Linear issue" },
    { name: "update_issue", description: "Update status, assignee or labels" },
    { name: "list_projects", description: "List active projects" },
  ],
});

export function genericTools(slug) {
  return [
    { name: "ping", description: `Health check for ${slug}` },
    { name: "list_resources", description: `List resources exposed by ${slug}` },
    { name: "call", description: `Invoke a ${slug} action` },
  ];
}

export function gatewayKeyValue(suffix) {
  return `sk-${MACHINE_ID}-${suffix}`;
}

export const MCP_KEYS = Object.freeze([
  {
    id: "gwkey-workstation", name: "Balin workstation (Claude Code)", key: gatewayKeyValue("a7c21e9f-5d"),
    machineId: MACHINE_ID, isActive: true, createdAt: isoAgo(20 * DAY_MS),
  },
  {
    id: "gwkey-agents", name: "Night agents", key: gatewayKeyValue("3be80d42-9a"),
    machineId: MACHINE_ID, isActive: true, createdAt: isoAgo(9 * DAY_MS),
  },
]);

// keyId -> [{ instanceId, toolAllowlist }]
export const MCP_GRANTS = Object.freeze({
  "gwkey-workstation": [
    { instanceId: "mcp-github", toolAllowlist: null },
    { instanceId: "mcp-filesystem", toolAllowlist: null },
    { instanceId: "mcp-linear", toolAllowlist: null },
  ],
  "gwkey-agents": [
    { instanceId: "mcp-github", toolAllowlist: ["search_code", "get_file_contents", "list_pull_requests"] },
  ],
});
