import { DashboardLayout } from "@/shared/components";
import MockNetwork from "@site/components/demo/MockNetwork.jsx";
import DemoBanner from "@site/components/demo/DemoBanner.jsx";
import DemoAuthGuard from "@site/components/demo/DemoAuthGuard.jsx";

export const metadata = { title: "DurinDoor demo dashboard" };

export default function Layout({ children }) {
  return (
    <>
      <MockNetwork />
      <DemoAuthGuard>
        <DashboardLayout>{children}</DashboardLayout>
        <DemoBanner />
      </DemoAuthGuard>
    </>
  );
}
