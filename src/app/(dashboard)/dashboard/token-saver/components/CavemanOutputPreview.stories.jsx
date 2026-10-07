import CavemanOutputPreview from "./CavemanOutputPreview.jsx";

export default {
  title: "Durin DS/Production Pages/token-saver/CavemanOutputPreview",
  component: CavemanOutputPreview,
  args: { level: "full", enabled: true },
  decorators: [(Story) => <div className="max-w-2xl p-4"><Story /></div>],
};

export const Full = {};
export const Lite = { args: { level: "lite" } };
export const Ultra = { args: { level: "ultra" } };
export const Wenyan = { args: { level: "wenyan" } };
export const Disabled = { args: { enabled: false } };
export const Mobile = { globals: { viewport: { value: "mobile1" } } };
