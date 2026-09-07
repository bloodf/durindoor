import React from "react";
import { MetaBadge } from "./TranslatorWorkspace.jsx";

const meta = {
  title: "Production/translator/MetaBadge",
  component: MetaBadge,
  parameters: { layout: "centered" },
};
export default meta;

export const Neutral = { args: { label: "Source", value: "OpenAI", tone: "neutral" } };
export const Info = { args: { label: "Source", value: "OpenAI", tone: "info" } };
export const Warning = { args: { label: "Target", value: "Responses", tone: "warning" } };
export const Success = { args: { label: "Provider", value: "codex", tone: "success" } };
export const Accent = { args: { label: "Model", value: "gpt-5.2-codex", tone: "accent" } };
