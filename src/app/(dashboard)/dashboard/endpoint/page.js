import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "./EndpointPageClient";

export default async function EndpointPage() {
  const machineId = await getMachineId();
  // Read the actual listen port from the Next.js custom server so the Local
  // URL reflects the live deployment (default port is 20128).
  const port = Number.parseInt(process.env.PORT || "20128", 10) || 20128;
  return <EndpointPageClient machineId={machineId} localPort={port} />;
}
