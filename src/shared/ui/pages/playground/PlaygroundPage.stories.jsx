import { useState } from "react";

import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import PlaygroundPage from "./PlaygroundPage.jsx";
import { CONVERSATION } from "./mockData.js";

const meta = {
  title: "Durin DS/Pages/Playground",
  component: PlaygroundPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/playground",
      title: "Playground",
      subtitle: "Test models through the local OpenAI-compatible endpoint",
      icon: "forum",
    }),
  ],
};

export default meta;

function PlaygroundStory({ messages = [], streaming = false }) {
  const [composer, setComposer] = useState("");
  const [visibleMessages, setVisibleMessages] = useState(messages);

  return (
    <PlaygroundPage
      messages={visibleMessages}
      composer={composer}
      streaming={streaming}
      onComposerChange={setComposer}
      onSuggestionClick={setComposer}
      onClear={() => {
        setVisibleMessages([]);
        setComposer("");
      }}
    />
  );
}

export const Empty = {
  render: () => <PlaygroundStory />,
};

export const WithConversation = {
  render: () => <PlaygroundStory messages={CONVERSATION} />,
};

export const Streaming = {
  render: () => <PlaygroundStory messages={CONVERSATION.slice(0, 2)} streaming />,
};
