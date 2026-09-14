import MockNetwork from "@site/components/demo/MockNetwork.jsx";
import DemoBanner from "@site/components/demo/DemoBanner.jsx";
import { DEMO_PASSWORD } from "@site/mock/demoPassword.js";

export const metadata = { title: "Sign in · DurinDoor demo" };

export default function LoginLayout({ children }) {
  return (
    <>
      <MockNetwork />
      {children}
      <DemoBanner hint={`Demo password: ${DEMO_PASSWORD}`} />
    </>
  );
}
