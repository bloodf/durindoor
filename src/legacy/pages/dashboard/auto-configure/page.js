import AutoConfigureClient from "./AutoConfigureClient.js";
import { getSettings } from "@/lib/localDb";
import { probeDefaultFirecrawlEndpoints } from "@/lib/firecrawl/firecrawlConfig.js";
import { getAutoConfigureStatus } from "@/lib/autoConfigure/index.js";

export const dynamic = "force-dynamic";

async function getStatus() {
  const settings = await getSettings();
  return getAutoConfigureStatus(settings, {
    firecrawl: {
      probe: probeDefaultFirecrawlEndpoints,
      listConnections: async ({ provider }) => {
        const { getProviderConnections } = await import("@/lib/localDb");
        return getProviderConnections({ provider });
      },
    },
  });
}

export default async function AutoConfigurePage() {
  const status = await getStatus().catch(() => null);
  return <AutoConfigureClient status={status} />;
}
