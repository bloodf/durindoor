import React, { useState } from "react";
import { fn, expect, userEvent, within } from "storybook/test";

import { MediaProviderCard } from "./MediaProviderCard";

const provider = { id: "openai", name: "OpenAI", textIcon: "OA" };

function StatefulCard({ connections, onToggle }) {
  const [items, setItems] = useState(connections);
  return (
    <MediaProviderCard
      provider={provider}
      kind="embedding"
      connections={items}
      onToggle={fn((id, active) => {
        setItems((current) => current.map((item) => item.provider === id ? { ...item, isActive: active } : item));
        onToggle?.(id, active);
      })}
    />
  );
}

export default {
  title: "Production/media/MediaProviderCard",
  component: StatefulCard,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/embedding",
      params: { kind: "embedding" },
      routes: {},
    },
  },
};

export const Connected = { args: { connections: [{ id: "openai-1", provider: "openai", testStatus: "success", isActive: true }] } };

export const Disabled = {
  args: { connections: [{ id: "openai-1", provider: "openai", testStatus: "success", isActive: false }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole("switch", { name: /Enable OpenAI/ });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  },
};

export const Error = { args: { connections: [{ id: "openai-1", provider: "openai", testStatus: "error", isActive: true }] } };
