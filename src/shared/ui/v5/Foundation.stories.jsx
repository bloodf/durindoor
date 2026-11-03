import { useState } from "react";
import { useTheme } from "@/shared/hooks/useTheme.js";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Notice,
  Panel,
  Skeleton,
  Switch,
} from "./components.jsx";
import DataTable from "./DataTable.jsx";
import { connections } from "./catalog.js";
import "./v5.css";
import ReviewFrame from "./ReviewFrame.jsx";

function ComponentGallery({
  pending = false,
  disabled = false,
  errors = false,
}) {
  const { theme } = useTheme();
  const [enabled, setEnabled] = useState(true);
  const [overlay, setOverlay] = useState(null);
  const [selected, setSelected] = useState(null);
  return (
    <div className="v5-root" data-theme={theme}>
      <main className="v5-component-preview v5-preview-wide">
        <h1>V5 component system</h1>
        <p className="v5-muted">
          Semantic controls, clear feedback, and consistent focus across both
          themes.
        </p>
        <div className="v5-two-column">
          <Panel title="Actions">
            <div className="v5-inline">
              <Button
                tone="primary"
                icon="add"
                busy={pending}
                disabled={disabled}
                onClick={() => setOverlay("Create item")}
              >
                Create item
              </Button>
              <Button
                icon="edit"
                disabled={disabled}
                onClick={() => setOverlay("Edit item")}
              >
                Edit
              </Button>
              <Button
                tone="danger"
                disabled={disabled}
                onClick={() => setOverlay("Delete sample item?")}
              >
                Delete
              </Button>
              <IconButton
                label="More actions"
                icon="more_horiz"
                disabled={disabled}
                onClick={() => setOverlay("More actions")}
              />
            </div>
          </Panel>
          <Panel title="Fields">
            <Field
              label="Display name"
              hint="Use a recognizable name."
              error={errors ? "Enter a display name." : undefined}
            >
              {(props) => (
                <input
                  {...props}
                  placeholder="Workspace name"
                  disabled={disabled}
                />
              )}
            </Field>
            <Field label="Description">
              {(props) => (
                <textarea
                  {...props}
                  placeholder="Add a short description"
                  rows="2"
                  disabled={disabled}
                />
              )}
            </Field>
            <Switch
              label="Enabled"
              description="Available in this workspace."
              checked={enabled}
              onChange={setEnabled}
              disabled={disabled}
            />
          </Panel>
          <Panel title="Status vocabulary">
            <div className="v5-inline">
              {[
                "Connected",
                "Disabled",
                "Expiring",
                "Rate limited",
                "Failed",
                "Pending",
                "Running",
                "Success",
              ].map((status) => (
                <Badge key={status}>{status}</Badge>
              ))}
            </div>
          </Panel>
          <Panel title="Feedback">
            <Notice tone="success" title="Changes saved">
              The sample configuration is up to date.
            </Notice>
            <Notice tone="warning" title="Authorization expires soon">
              Reconnect the account before its next use.
            </Notice>
            <Notice
              tone="danger"
              title="Connection failed"
              action={
                <Button onClick={() => setOverlay("Retry connection")}>
                  Try again
                </Button>
              }
            >
              Check the credential and test the connection again.
            </Notice>
            <Notice title="Read-only access">
              You can inspect this configuration.
            </Notice>
          </Panel>
        </div>
        <Panel title="Data table">
          <DataTable
            rows={connections}
            readOnly={disabled}
            onInspect={setSelected}
            onBulkChange={() => setOverlay("Sample bulk action")}
          />
        </Panel>
        {selected && (
          <Dialog
            drawer
            title={selected.name}
            onClose={() => setSelected(null)}
          >
            <Badge>{selected.status}</Badge>
            <p>{selected.detail}</p>
          </Dialog>
        )}
        {overlay && (
          <Dialog
            title={overlay}
            onClose={() => setOverlay(null)}
            footer={
              <>
                <Button onClick={() => setOverlay(null)}>Cancel</Button>
                <Button
                  tone={overlay.startsWith("Delete") ? "danger" : "primary"}
                  onClick={() => setOverlay(null)}
                >
                  {overlay.startsWith("Delete") ? "Delete sample" : "Done"}
                </Button>
              </>
            }
          >
            <p>
              This dialog changes sample data only. Escape closes it and returns
              focus to the trigger.
            </p>
          </Dialog>
        )}
      </main>
    </div>
  );
}
export default {
  title: "Archive/Rejected v5 prototype/Components/Control system",
  component: ComponentGallery,
  parameters: { layout: "fullscreen" },
};
export const AllControls = {};
export const Disabled = { args: { disabled: true } };
export const Pending = { args: { pending: true } };
export const Invalid = { args: { errors: true } };
export const LoadingSkeleton = {
  render: () => (
    <ReviewFrame>
      <Skeleton />
    </ReviewFrame>
  ),
};
export const EmptyContent = {
  render: () => (
    <ReviewFrame>
      <EmptyState
        title="Connect your first provider"
        description="A provider connection makes its models available to your gateway."
        icon="dns"
      />
    </ReviewFrame>
  ),
};
