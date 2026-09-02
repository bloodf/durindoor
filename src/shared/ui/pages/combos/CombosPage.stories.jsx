import React from "react";

globalThis.React ??= React;

import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import CombosPage from "./CombosPage.jsx";
import { combos } from "./mockData.js";

const pageAction = (
  <Button variant="primary" size="sm" icon="add">
    Create Combo
  </Button>
);

const meta = {
  title: "Durin DS/Pages/Combos",
  component: CombosPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/combos",
      title: "Combos",
      subtitle: "Model combos with fallback",
      icon: "layers",
      actions: pageAction,
    }),
  ],
};

export default meta;

export const Default = {
  args: { combos: combos.slice(0, 6) },
};

function CreateComboModal() {
  const [open, setOpen] = React.useState(true);
  const [models, setModels] = React.useState([
    "codex/gpt-5.6-sol",
    "cc/claude-fable-5",
    "gemini/gemini-3.1-pro",
  ]);
  const reorder = (from, to) => {
    if (from === to || to < 0 || to >= models.length) return;
    setModels((current) => {
      const reordered = [...current];
      const [model] = reordered.splice(from, 1);
      reordered.splice(to, 0, model);
      return reordered;
    });
  };

  const move = (index, offset) => reorder(index, index + offset);

  return (
    <>
      <CombosPage combos={combos.slice(0, 6)} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create combo"
        subtitle="Models are tried from top to bottom when fallback is active."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="add" onClick={() => setOpen(false)}>
              Create Combo
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <Input label="Name" placeholder="research" autoFocus />
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-dd-text">Models</p>
                <p className="text-xs text-dd-muted">Drag or use arrows to set fallback order.</p>
              </div>
              <Button size="sm" icon="add">
                Add model
              </Button>
            </div>
            <ol className="overflow-hidden rounded-dd border border-dd-border bg-dd-surface-2">
              {models.map((model, index) => (
                <li
                  key={model}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    reorder(Number(event.dataTransfer.getData("text/plain")), index);
                  }}
                  className="flex items-center gap-2 border-b border-dd-border-subtle px-3 py-2.5 last:border-b-0"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined cursor-grab text-[18px] leading-none text-dd-subtle"
                  >
                    drag_indicator
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-dd-text">{model}</span>
                  <IconButton
                    icon="keyboard_arrow_up"
                    label={`Move ${model} up`}
                    size="sm"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                  <IconButton
                    icon="keyboard_arrow_down"
                    label={`Move ${model} down`}
                    size="sm"
                    disabled={index === models.length - 1}
                    onClick={() => move(index, 1)}
                  />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Modal>
    </>
  );
}

export const OpenCreateModal = {
  render: () => <CreateComboModal />,
};

export const EmptyState = {
  args: { combos: [] },
};
