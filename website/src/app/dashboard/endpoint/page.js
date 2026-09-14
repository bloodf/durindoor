import EndpointPageClient from "@/app/(dashboard)/dashboard/endpoint/EndpointPageClient";
import { LOCAL_PORT, MACHINE_ID } from "@site/mock/fixtures/world.js";

export default function EndpointPage() {
  return <EndpointPageClient machineId={MACHINE_ID} localPort={LOCAL_PORT} />;
}
