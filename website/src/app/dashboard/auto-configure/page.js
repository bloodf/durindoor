import AutoConfigureClient from "@/app/(dashboard)/dashboard/auto-configure/AutoConfigureClient.js";
import { AUTO_CONFIGURE_STATUS } from "@site/mock/fixtures/autoConfigure.js";

// The real page computes a dry-run report on the server; the demo ships a fixture.
export default function AutoConfigurePage() {
  return <AutoConfigureClient status={AUTO_CONFIGURE_STATUS} />;
}
