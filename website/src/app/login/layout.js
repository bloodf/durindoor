import MockNetwork from "@site/components/demo/MockNetwork.jsx";
import DemoBanner from "@site/components/demo/DemoBanner.jsx";
import DemoPasswordNotice from "@site/components/demo/DemoPasswordNotice.jsx";

export const metadata = { title: "Sign in · DurinDoor demo" };

export default function LoginLayout({ children }) {
  return (
    <>
      <MockNetwork />
      <DemoPasswordNotice />
      {children}
      <DemoBanner />
    </>
  );
}
