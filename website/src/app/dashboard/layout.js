import { DashboardLayout } from "@/shared/components";
import MockNetwork from "@site/components/demo/MockNetwork.jsx";
import DemoBanner from "@site/components/demo/DemoBanner.jsx";

export const metadata = { title: "DurinDoor demo dashboard" };

export default function Layout({ children }) {
  return (
    <>
      <MockNetwork />
      <DashboardLayout>{children}</DashboardLayout>
      <DemoBanner />
    </>
  );
}
