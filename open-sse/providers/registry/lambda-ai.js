export default {
  id: "lambda-ai",
  priority: 70,
  alias: "lambda",
  display: {
    name: "Lambda AI",
    icon: "cloud",
    color: "#FF7300",
    textIcon: "LA",
    website: "https://lambda.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.lambda.ai/v1/chat/completions",
    validateUrl: "https://api.lambda.ai/v1/models",
    authHeader: "bearer",
  },
  models: [
    { id: "deepseek-r1-671b", name: "deepseek-r1-671b" },
    { id: "llama3.3-70b-instruct-fp8", name: "llama3.3-70b-instruct-fp8" },
    { id: "qwen25-coder-32b-instruct", name: "qwen25-coder-32b-instruct" },
  ],
  serviceKinds: ["llm"],
};
