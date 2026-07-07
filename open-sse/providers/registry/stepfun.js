export default {
  id: "stepfun",
  alias: "stepfun",
  display: {
    name: "StepFun",
    icon: "auto_awesome",
    iconUrl: "/providers/stepfun.svg",
    color: "#8B5CF6",
    textIcon: "SF",
    website: "https://stepfun.com",
    notice: {
      text: "This connects to StepFun China. Users outside mainland China can instead register at the global StepFun Open Platform.",
      signupUrl: "https://platform.stepfun.ai",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.stepfun.com/v1/chat/completions",
  },
  models: [
    { id: "step-3.7-flash", name: "Step 3.7 Flash", contextLength: 262144 },
    { id: "step-3.5-flash", name: "Step 3.5 Flash", contextLength: 262144 },
    { id: "step-3.5-flash-2603", name: "Step 3.5 Flash 2603", contextLength: 262144 },
    { id: "step-1o-turbo-vision", name: "Step 1o Turbo Vision", contextLength: 32768 },
    { id: "step-1v", name: "Step 1V" },
  ],
  passthroughModels: true,
};
