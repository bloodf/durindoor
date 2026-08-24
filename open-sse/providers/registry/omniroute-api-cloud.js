const bearerAuth = {
  combined: true,
  header: "Authorization",
  scheme: "bearer"
};

const openAiProvider = ({
  id,
  alias,
  name,
  baseUrl,
  validateUrl,
  icon = "hub",
  color = "#6366F1",
  textIcon,
  website,
  deprecated = false,
  deprecationNotice,
  hasProviderSpecificData = false,
  models = []
}) => ({
  id,
  alias,
  display: {
    name,
    icon,
    color,
    textIcon,
    website,
    deprecated,
    deprecationNotice
  },
  category: "apikey",
  ...(hasProviderSpecificData ? { hasProviderSpecificData: true } : null),
  transport: {
    baseUrl,
    validateUrl,
    headers: {},
    auth: bearerAuth
  },
  // Ported from OmniRoute non-registry provider sources at commit 3ddcee6.
  models,
  passthroughModels: true
});

export default [
openAiProvider({
  id: "360ai",
  alias: "360ai",
  name: "360 AI",
  baseUrl: "https://api.360.cn/v1/chat/completions",
  validateUrl: "https://api.360.cn/v1/models",
  icon: "auto_awesome",
  color: "#00B96B",
  textIcon: "360",
  website: "https://ai.360.cn"
}),
openAiProvider({
  id: "arcee-ai",
  alias: "arcee",
  name: "Arcee AI",
  baseUrl: "https://conductor.arcee.ai/v1/chat/completions",
  validateUrl: "https://conductor.arcee.ai/v1/models",
  icon: "auto_awesome",
  color: "#8B5CF6",
  textIcon: "AR",
  website: "https://arcee.ai"
}),
{
  id: "azure-ai",
  alias: "azure-ai",
  display: {
    name: "Azure AI Foundry",
    icon: "cloud",
    color: "#2563EB",
    textIcon: "AF",
    website: "https://learn.microsoft.com/azure/ai-foundry"
  },
  category: "apikey",
  hasProviderSpecificData: true,
  transport: {
    baseUrl: "https://example-resource.services.ai.azure.com/openai/v1/chat/completions",
    validateUrl: "https://example-resource.services.ai.azure.com/openai/v1/models",
    headers: {},
    auth: { combined: true, header: "api-key", scheme: "raw" }
  },
  models: [],
  passthroughModels: true
},
{
  id: "azure-openai",
  alias: "azure-openai",
  display: {
    name: "Azure OpenAI",
    icon: "cloud",
    color: "#0078D4",
    textIcon: "AZ",
    website: "https://azure.microsoft.com/products/ai-services/openai-service"
  },
  category: "apikey",
  hasProviderSpecificData: true,
  transport: {
    baseUrl: "https://example-resource.openai.azure.com",
    headers: {},
    auth: { combined: true, header: "api-key", scheme: "raw" },
    executor: "azure-openai"
  },
  models: [],
  passthroughModels: true
},
openAiProvider({
  id: "cablyai",
  alias: "cablyai",
  name: "CablyAI",
  baseUrl: "https://api.cablyai.com/v1/chat/completions",
  validateUrl: "https://api.cablyai.com/v1/models",
  color: "#FF4081",
  textIcon: "CA",
  website: "https://cablyai.com",
  deprecated: true,
  deprecationNotice:
  "cablyai.com no longer resolves in the OmniRoute source audit; keep existing configs importable but expect network failure."
}),
{
  id: "clarifai",
  alias: "clarifai",
  display: {
    name: "Clarifai",
    icon: "hub",
    color: "#7C3AED",
    textIcon: "CF",
    website: "https://docs.clarifai.com"
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.clarifai.com/v2/ext/openai/v1/chat/completions",
    validateUrl: "https://api.clarifai.com/v2/ext/openai/v1/models",
    headers: {},
    auth: { combined: true, header: "Authorization", scheme: "key" }
  },
  models: [],
  passthroughModels: true
},
{
  id: "cliproxyapi",
  alias: "cpa",
  display: {
    name: "CLIProxyAPI",
    icon: "proxy",
    color: "#6366F1",
    textIcon: "CPA",
    website: "https://github.com/router-for-me/CLIProxyAPI"
  },
  category: "apikey",
  transport: {
    baseUrl: "http://127.0.0.1:8317/v1/chat/completions",
    validateUrl: "http://127.0.0.1:8317/v1/models",
    headers: {},
    auth: bearerAuth
  },
  models: [],
  passthroughModels: true
},
openAiProvider({
  id: "datarobot",
  alias: "datarobot",
  name: "DataRobot",
  baseUrl: "https://app.datarobot.com/api/v2/genai/llmgw/chat/completions/",
  validateUrl: "https://app.datarobot.com/api/v2/genai/llmgw/catalog/",
  icon: "precision_manufacturing",
  color: "#6D28D9",
  textIcon: "DR",
  website: "https://docs.datarobot.com"
}),
openAiProvider({
  id: "empower",
  alias: "empower",
  name: "Empower",
  baseUrl: "https://app.empower.dev/api/v1/chat/completions",
  validateUrl: "https://app.empower.dev/api/v1/models",
  color: "#14B8A6",
  textIcon: "EM",
  website: "https://docs.empower.dev"
}),
openAiProvider({
  id: "fenayai",
  alias: "fenayai",
  name: "FenayAI",
  baseUrl: "https://api.fenayai.com/v1/chat/completions",
  validateUrl: "https://api.fenayai.com/v1/models",
  color: "#FF9800",
  textIcon: "FN",
  website: "https://fenayai.com"
}),
openAiProvider({
  id: "getgoapi",
  alias: "ggo",
  name: "GoAPI",
  baseUrl: "https://api.getgoapi.com/v1/chat/completions",
  validateUrl: "https://api.getgoapi.com/v1/models",
  icon: "rocket_launch",
  color: "#FF6D00",
  textIcon: "GO",
  website: "https://api.getgoapi.com"
}),
openAiProvider({
  id: "laozhang",
  alias: "lz",
  name: "LaoZhang AI",
  baseUrl: "https://api.laozhang.ai/v1/chat/completions",
  validateUrl: "https://api.laozhang.ai/v1/models",
  color: "#FF1744",
  textIcon: "LZ",
  website: "https://api.laozhang.ai"
}),
{
  id: "nomic",
  alias: "nomic",
  display: {
    name: "Nomic",
    icon: "hub",
    color: "#7C3AED",
    textIcon: "NM",
    website: "https://nomic.ai"
  },
  category: "hidden",
  transport: {
    baseUrl: "https://api-atlas.nomic.ai/v1/embedding/text",
    validateUrl: "https://api-atlas.nomic.ai/v1/models",
    headers: {},
    auth: bearerAuth
  },
  serviceKinds: [],
  // Keep Nomic importable, but do not advertise embeddings until a Nomic
  // adapter is registered for /v1/embeddings.
  models: [],
  passthroughModels: true
},
openAiProvider({
  id: "oci",
  alias: "oci",
  name: "OCI Generative AI",
  baseUrl: "https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/openai/v1/chat/completions",
  validateUrl: "https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/openai/v1/models",
  icon: "cloud",
  color: "#C74634",
  textIcon: "OCI",
  website: "https://www.oracle.com/artificial-intelligence/generative-ai"
}),
openAiProvider({
  id: "piapi",
  alias: "pi",
  name: "PiAPI",
  baseUrl: "https://api.piapi.ai/v1/chat/completions",
  validateUrl: "https://api.piapi.ai/v1/models",
  icon: "api",
  color: "#7C4DFF",
  textIcon: "PI",
  website: "https://piapi.ai"
}),
openAiProvider({
  id: "poe",
  alias: "poe",
  name: "Poe",
  baseUrl: "https://api.poe.com/v1/chat/completions",
  validateUrl: "https://api.poe.com/v1/models",
  color: "#F97316",
  textIcon: "PO",
  website: "https://creator.poe.com/api-reference"
}),
openAiProvider({
  id: "sap",
  alias: "sap",
  name: "SAP Generative AI Hub",
  baseUrl: "https://example-aicore.cfapps.eu10.hana.ondemand.com/v2/lm/deployments/example-deployment/chat/completions",
  validateUrl: "https://example-aicore.cfapps.eu10.hana.ondemand.com/v2/lm/scenarios/foundation-models/models",
  icon: "business",
  color: "#0FAAFF",
  textIcon: "SAP",
  website: "https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/generative-ai-hub-in-sap-ai-core",
  hasProviderSpecificData: true
}),
openAiProvider({
  id: "thebai",
  alias: "thebai",
  name: "TheB.AI",
  baseUrl: "https://api.theb.ai/v1/chat/completions",
  validateUrl: "https://api.theb.ai/v1/models",
  color: "#3B82F6",
  textIcon: "TB",
  website: "https://theb.ai"
}),
openAiProvider({
  id: "watsonx",
  alias: "watsonx",
  name: "IBM watsonx.ai Gateway",
  baseUrl: "https://ca-tor.ml.cloud.ibm.com/ml/gateway/v1/chat/completions",
  validateUrl: "https://ca-tor.ml.cloud.ibm.com/ml/gateway/v1/models",
  icon: "hub",
  color: "#0F62FE",
  textIcon: "WX",
  website: "https://www.ibm.com/products/watsonx-ai"
})];