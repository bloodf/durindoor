import StatCard from "./StatCard.jsx";

const meta = {
  title: "Durin DS/Data/StatCard",
  component: StatCard,
  parameters: { layout: "centered" },
};

export default meta;

/** A single dashboard metric with a neutral value and positive weekly change. */
export const RequestsToday = {
  args: {
    icon: "query_stats",
    label: "Requests today",
    value: "24,871",
    delta: { value: "+12.4%", tone: "success" },
    hint: "Compared with yesterday",
  },
};

/** Four dashboard metrics across supported semantic and brand value tones. */
export const DashboardMetrics = {
  render: () => (
    <div className="grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon="bolt"
        label="Tokens processed"
        value="18.6M"
        tone="accent"
        delta={{ value: "+8.2%", tone: "success" }}
        hint="Last 30 days"
      />
      <StatCard
        icon="check_circle"
        label="Success rate"
        value="99.94%"
        tone="success"
        delta={{ value: "+0.12 pts", tone: "success" }}
        hint="Last 24 hours"
      />
      <StatCard
        icon="schedule"
        label="P95 latency"
        value="842 ms"
        tone="warning"
        delta={{ value: "+96 ms", tone: "danger" }}
        hint="Last 24 hours"
      />
      <StatCard
        icon="error"
        label="Failed requests"
        value="37"
        tone="danger"
        delta={{ value: "-18.6%", tone: "success" }}
        hint="Compared with yesterday"
      />
    </div>
  ),
};
