import DashboardShell from "./DashboardShell";

/** Creates a fullscreen-compatible decorator; page identity stays in PageHeader. */
export function withDashboardShell({ activePath = "", actions } = {}) {
  return function DashboardShellDecorator(Story) {
    return (
      <DashboardShell activePath={activePath} actions={actions} onNavigate={() => undefined}>
        <Story />
      </DashboardShell>
    );
  };
}

export default withDashboardShell;
