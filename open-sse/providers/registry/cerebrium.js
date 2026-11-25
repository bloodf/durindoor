export default {
  id: "cerebrium", alias: "cerebrium", category: "apikey",
  display: { name: "Cerebrium", icon: "cloud", color: "#5546ff", textIcon: "CB", website: "https://cerebrium.ai" },
  authType: "apikey", hasProviderSpecificData: true,
  transport: { format: "openai", auth: { combined: true, header: "Authorization", scheme: "bearer" }, executor: "cerebrium" },
  models: [], passthroughModels: true,
};
