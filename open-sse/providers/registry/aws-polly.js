// No SigV4 synthesis handler exists yet, so these rows stay out of every picker.
const POLLY_UNAVAILABLE = "AWS Polly synthesis is not implemented";

export default {
  id: "aws-polly",
  alias: "polly",
  display: {
    name: "AWS Polly",
    icon: "record_voice_over",
    color: "#FF9900",
    textIcon: "PL",
    website: "https://aws.amazon.com/polly/",
    notice: {
      text: "Use AWS Secret Access Key as API key; set providerSpecificData.accessKeyId and optional region.",
      apiKeyUrl: "https://console.aws.amazon.com/iam/home#/security_credentials"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "tts"
  ],
  ttsConfig: {
    baseUrl: "https://polly.{region}.amazonaws.com/v1/speech",
    authType: "apikey",
    authHeader: "aws-sigv4",
    format: "aws-polly",
    models: [
      {
        id: "standard",
        routingUnavailableReason: POLLY_UNAVAILABLE,
        name: "Standard"
      },
      {
        id: "neural",
        routingUnavailableReason: POLLY_UNAVAILABLE,
        name: "Neural"
      },
      {
        id: "long-form",
        routingUnavailableReason: POLLY_UNAVAILABLE,
        name: "Long-form"
      },
      {
        id: "generative",
        routingUnavailableReason: POLLY_UNAVAILABLE,
        name: "Generative"
      }
    ]
  },
  hasProviderSpecificData: true
};
