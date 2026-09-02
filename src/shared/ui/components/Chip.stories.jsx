/**
 * Durin DS — Chip stories (group: Surfaces).
 *
 * Covers both sizes, icons, clickable + selected states (gold accent), and
 * removable chips — including an interactive chip cloud with real
 * remove/select state. Stories set no backgrounds — the "Theme" toolbar
 * toggle drives dark/light.
 */
import { useState } from "react";

import { Chip } from "./Chip.jsx";

const meta = {
  title: "Durin DS/Surfaces/Chip",
  component: Chip,
  parameters: { layout: "centered" },
  argTypes: {
    size: { control: "radio", options: ["sm", "md"] },
    selected: { control: "boolean" },
    icon: { control: "text" },
  },
};

export default meta;

/** Controls-driven single chip (click logs to the Actions panel). */
export const Playground = {
  args: { label: "gpt-5", icon: "smart_toy", size: "md", selected: false },
  render: (args) => <Chip {...args} onClick={() => {}} />,
};

/** sm and md, with and without icons. */
export const Sizes = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2">
        <Chip size="md" icon="smart_toy" label="gpt-5" />
        <Chip size="md" label="claude-sonnet-4.5" />
      </div>
      <div className="flex items-center gap-2">
        <Chip size="sm" icon="smart_toy" label="gpt-5-mini" />
        <Chip size="sm" label="gemini-3-pro" />
      </div>
    </div>
  ),
};

/** Selected (gold border + soft bg), clickable, and removable states. */
export const States = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2">
        <Chip label="Static" />
        <Chip label="Selected" selected />
        <Chip label="Clickable" onClick={() => {}} />
        <Chip label="Clickable selected" selected onClick={() => {}} />
      </div>
      <div className="flex items-center gap-2">
        <Chip label="Removable" onRemove={() => {}} />
        <Chip label="Both" icon="smart_toy" onClick={() => {}} onRemove={() => {}} />
        <Chip size="sm" label="Small removable" onRemove={() => {}} />
      </div>
    </div>
  ),
};

/** Stateful demo component for the cloud story (named so hooks lint cleanly). */
function ChipCloudDemo() {
  const [chips, setChips] = useState([
    { id: "gpt-5", icon: "smart_toy", selected: true },
    { id: "gpt-5-mini", icon: "smart_toy", selected: false },
    { id: "claude-sonnet-4.5", icon: "smart_toy", selected: true },
    { id: "gemini-3-pro", icon: "smart_toy", selected: false },
    { id: "gpt-image-1", icon: "image", selected: false },
    { id: "whisper-1", icon: "mic", selected: false },
  ]);
  const toggle = (id) =>
    setChips((list) =>
      list.map((chip) => (chip.id === id ? { ...chip, selected: !chip.selected } : chip)),
    );
  const remove = (id) => setChips((list) => list.filter((chip) => chip.id !== id));

  return (
    <div className="flex w-96 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <Chip
            key={chip.id}
            icon={chip.icon}
            label={chip.id}
            selected={chip.selected}
            onClick={() => toggle(chip.id)}
            onRemove={() => remove(chip.id)}
          />
        ))}
      </div>
      {chips.length === 0 ? (
        <p className="text-xs text-dd-muted">All models removed.</p>
      ) : (
        <p className="text-xs text-dd-muted">
          {chips.filter((chip) => chip.selected).length} of {chips.length} selected
        </p>
      )}
    </div>
  );
}

/** Interactive cloud: click to select (gold), × to remove. State is real. */
export const ChipCloud = {
  render: () => <ChipCloudDemo />,
};

/** Stateful demo component for the filter story (named so hooks lint cleanly). */
function FilterChipsDemo() {
  const [active, setActive] = useState("all");
  const filters = [
    { id: "all", icon: "apps" },
    { id: "openai", icon: "database" },
    { id: "anthropic", icon: "database" },
    { id: "local", icon: "computer" },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {filters.map((filter) => (
        <Chip
          key={filter.id}
          size="sm"
          icon={filter.icon}
          label={filter.id === "all" ? "All" : filter.id}
          selected={active === filter.id}
          onClick={() => setActive(filter.id)}
        />
      ))}
    </div>
  );
}

/** Chips as provider filters inside a toolbar row. */
export const AsFilters = {
  render: () => <FilterChipsDemo />,
};
