import { createProvider } from "@/lib/providerRouteHandlers";

export { GET, canDiscoverModels } from "@/lib/providerRouteHandlers";
export const dynamic = "force-dynamic";

// Next supplies route context as the second argument, never trusted commit options.
export async function POST(request) {
  return createProvider(request);
}
