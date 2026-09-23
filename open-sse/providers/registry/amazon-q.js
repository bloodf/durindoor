import kiro from "./kiro.js";

// Amazon Q Developer. Same CodeWhisperer backend, AWS Builder ID / IAM Identity
// Center device login, refresh and model catalog as Kiro, registered as its own
// provider so Amazon Q connections, quota and fallback stay apart from Kiro's.
export default {
  id: "amazon-q",
  priority: 11,
  alias: "aq",
  uiAlias: "aq",
  display: {
    name: "Amazon Q",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "AQ",
    website: "https://aws.amazon.com/q/developer/",
    notice: {
      text: "Uses the same AWS Builder ID or IAM Identity Center login as Kiro, but keeps Amazon Q connections separate.",
    },
  },
  category: "oauth",
  transport: kiro.transport,
  models: kiro.models,
  oauth: {
    ...kiro.oauth,
    // Social login and token import stay Kiro-only.
    authMethods: ["builder-id", "idc"],
  },
  features: {
    usage: true,
  },
};
