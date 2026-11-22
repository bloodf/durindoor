import "@/shared/ui/v5/production/v5-tokens.css";
import { DashboardLayout } from "@/shared/components";
import { isUiV5Enabled } from "@/shared/ui/v5/production/uiVersion";
import MockNetwork from "@site/components/demo/MockNetwork.jsx";
import DemoBanner from "@site/components/demo/DemoBanner.jsx";
import DemoAuthGuard from "@site/components/demo/DemoAuthGuard.jsx";
import UiV5Root from "./UiV5Root.jsx";

export const metadata = { title: "DurinDoor demo dashboard", robots: { index: false, follow: false } };

// The demo follows the app's switch: V5 unless DURINDOOR_UI_V5 is 0, false or off.
const SET_ATTRIBUTE = `document.documentElement.setAttribute("data-ui","v5")`;

export default function Layout({ children }) {
  const v5 = isUiV5Enabled();
  return (
    <>
      {/* Pre-paint attribute for the first server render; UiV5Root keeps it in sync on client navigation. */}
      {v5 ? <script dangerouslySetInnerHTML={{ __html: SET_ATTRIBUTE }} /> : null}
      <UiV5Root enabled={v5} />
      <MockNetwork />
      <DemoAuthGuard>
        <DashboardLayout>{children}</DashboardLayout>
        <DemoBanner />
      </DemoAuthGuard>
    </>
  );
}
