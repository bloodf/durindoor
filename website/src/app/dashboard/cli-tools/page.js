import CLIToolsPageClient from "@/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient";
import { MACHINE_ID } from "@site/mock/fixtures/world.js";

export default function CLIToolsPage() {
  return <CLIToolsPageClient machineId={MACHINE_ID} />;
}
