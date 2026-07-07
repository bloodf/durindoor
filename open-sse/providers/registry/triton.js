export default {
  id: "triton",
  priority: 71,
  alias: "triton",
  display: {
    name: "NVIDIA Triton",
    icon: "developer_board",
    color: "#76B900",
    textIcon: "TR",
    website: "https://developer.nvidia.com/triton-inference-server",
  },
  category: "apikey",
  authType: "apikey",
  noAuth: true,
  authHint: "API key optional. Configure the Triton OpenAI-compatible base URL (default: http://localhost:8000/v1).",
  transport: {
    baseUrl: "http://localhost:8000/v1",
    format: "openai",
  },
  models: [],
  passthroughModels: true,
};
