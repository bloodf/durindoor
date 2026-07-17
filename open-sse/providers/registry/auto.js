export default {
  id: "auto",
  priority: 900,
  alias: "auto",
  display: {
    name: "Auto (Zero-Config)",
    icon: "auto_awesome",
    color: "#6366F1",
    textIcon: "Auto",
    notice: {
      text: "System-only auto-routing metadata. Runtime requests still resolve through configured combos and connected providers.",
    },
  },
  category: "system",
  transport: null,
  models: [
    { id: "auto", name: "Auto (Best Available)" },
  ],
};
