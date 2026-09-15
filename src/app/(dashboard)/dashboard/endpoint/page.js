import EndpointPageClient from "./EndpointPageClient";

export default function EndpointPage() {
  // URL reflects the live deployment (default port is 20128).
  const port = Number.parseInt(process.env.PORT || "20128", 10) || 20128;
  return <EndpointPageClient localPort={port} />;
}
