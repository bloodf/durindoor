import MockNetwork from "@site/components/demo/MockNetwork.jsx";
import DemoBanner from "@site/components/demo/DemoBanner.jsx";

export const metadata = { title: "Sign in · DurinDoor demo" };

export default function LoginLayout({ children }) {
  return (
    <>
      <MockNetwork />
      {children}
      <DemoBanner hint="Any password signs you in." />
    </>
  );
}
