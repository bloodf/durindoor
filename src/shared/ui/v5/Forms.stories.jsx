import { ConnectionForm, ComboEditor, SettingsForm } from "./Forms.jsx";
import { useTheme } from "@/shared/hooks/useTheme.js";
import "./v5.css";
import ReviewFrame from "./ReviewFrame.jsx";
function FormPreview(args) {
  const { theme } = useTheme();
  return (
    <div className="v5-root" data-theme={theme}>
      <div className="v5-component-preview">
        <ConnectionForm {...args} />
      </div>
    </div>
  );
}
export default {
  title: "Archive/Rejected v5 prototype/Components/Connection form",
  component: FormPreview,
  parameters: { layout: "fullscreen" },
  argTypes: {
    initialState: {
      control: "select",
      options: [
        "idle",
        "invalid",
        "testing",
        "error",
        "tested",
        "saving",
        "success",
      ],
    },
  },
};
export const Default = {};
export const ValidationErrors = { args: { initialState: "invalid" } };
export const Testing = { args: { initialState: "testing" } };
export const Failed = { args: { initialState: "error" } };
export const Verified = { args: { initialState: "tested" } };
export const Saving = { args: { initialState: "saving" } };
export const Saved = { args: { initialState: "success" } };
export const ReadOnly = { args: { initialState: "tested", readOnly: true } };
export const DirtySettings = {
  render: () => (
    <ReviewFrame>
      <SettingsForm initialDirty onNotify={() => {}} />
    </ReviewFrame>
  ),
};
export const RouteEditor = {
  render: () => (
    <ReviewFrame wide>
      <ComboEditor onNotify={() => {}} />
    </ReviewFrame>
  ),
};
