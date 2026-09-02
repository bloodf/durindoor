import { useEffect, useId, useRef, useState } from "react";

import Button from "@/shared/ui/components/Button.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";

import {
  CONNECTION_OPTIONS,
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  SUGGESTIONS,
} from "./mockData.js";

const providerFromModel = (model) => model.split("/", 1)[0];

/** Model dropdown with JSX logo rows, which the shared string-label Select cannot render. */
function ModelSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? null;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (option) => {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Model"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-dd border border-dd-border bg-dd-surface px-3 text-left text-[13px] text-dd-text outline-none transition-colors hover:border-dd-border-subtle focus-visible:border-dd-accent focus-visible:shadow-dd-focus"
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            <ProviderLogo
              key={selected.value}
              provider={providerFromModel(selected.value)}
              size={20}
            />
            <span className="truncate">{selected.label}</span>
          </span>
        ) : (
          <span className="truncate text-dd-subtle">Select…</span>
        )}
        <span
          aria-hidden="true"
          className={`material-symbols-outlined shrink-0 text-[18px] leading-none text-dd-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
      </button>

      {open ? (
        <ul
          role="listbox"
          id={listboxId}
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-dd border border-dd-border bg-dd-surface py-1 shadow-dd-elevated"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => choose(option)}
                  className={
                    isSelected
                      ? "flex w-full items-center gap-2 bg-dd-accent-soft px-3 py-2 text-left text-[13px] text-dd-accent"
                      : "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-dd-text hover:bg-dd-surface-2"
                  }
                >
                  <ProviderLogo provider={providerFromModel(option.value)} size={18} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{option.label}</span>
                    <span className="truncate text-xs text-dd-subtle">{option.hint}</span>
                  </span>
                  {isSelected ? (
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined shrink-0 text-[18px] leading-none"
                    >
                      check
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function Toolbar({ model, onModelChange, onClear }) {
  const [connection, setConnection] = useState("auto");
  const [effort, setEffort] = useState("auto");

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-dd-border-subtle bg-dd-surface px-4 py-3">
      <div className="min-w-64 flex-1">
        <span className="mb-1 block text-xs font-medium text-dd-muted">Model</span>
        <ModelSelect options={MODEL_OPTIONS} value={model} onChange={onModelChange} />
      </div>
      <div className="w-40">
        <span className="mb-1 block text-xs font-medium text-dd-muted">Connection</span>
        <Select
          aria-label="Connection"
          options={CONNECTION_OPTIONS}
          value={connection}
          onChange={setConnection}
        />
      </div>
      <div className="w-32">
        <span className="mb-1 block text-xs font-medium text-dd-muted">Effort</span>
        <Select
          aria-label="Effort"
          options={EFFORT_OPTIONS}
          value={effort}
          onChange={setEffort}
        />
      </div>
      <div className="flex items-center gap-1 pb-px">
        <Button variant="ghost" icon="history">
          History
        </Button>
        <Button variant="ghost" icon="delete_sweep" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

function EmptyPlayground({ onSuggestionClick }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-14">
      <div className="flex max-w-xl flex-col items-center text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-dd-lg bg-dd-accent-soft text-dd-accent">
          <span aria-hidden="true" className="material-symbols-outlined text-[28px]">
            forum
          </span>
        </div>
        <h2 className="text-xl font-semibold text-dd-text">Playground</h2>
        <p className="mt-2 max-w-lg text-[13px] leading-5 text-dd-muted">
          Send a prompt through DurinDoor&apos;s local OpenAI-compatible /v1 endpoint and inspect
          how the selected model responds.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <Chip
              key={suggestion}
              icon="north_west"
              label={suggestion}
              onClick={() => onSuggestionClick?.(suggestion)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ message, model, streaming = false }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl rounded-2xl bg-dd-accent-soft px-4 py-3 text-[13px] leading-5 text-dd-text">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <article className="max-w-3xl rounded-dd-lg border border-dd-border bg-dd-surface px-4 py-3 text-[13px] leading-5 text-dd-text">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-dd-muted">
          <ProviderLogo key={model} provider={providerFromModel(model)} size={18} />
          Assistant
        </div>
        <p>
          {message.content}
          {streaming ? (
            <span
              aria-label="Streaming response"
              className="ml-1 inline-block h-2 w-2 rounded-full bg-dd-accent align-middle animate-pulse"
            />
          ) : null}
        </p>
        {message.code ? (
          <pre className="mt-3 overflow-x-auto rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3 font-mono text-xs leading-5 text-dd-text">
            <code>{message.code}</code>
          </pre>
        ) : null}
      </article>
    </div>
  );
}

function Conversation({ messages, model, streaming }) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-dd-bg-alt px-5 py-6 lg:px-8">
      {messages.map((message, index) => (
        <ChatMessage
          key={message.id}
          message={message}
          model={model}
          streaming={streaming && index === messages.length - 1 && message.role === "assistant"}
        />
      ))}
    </div>
  );
}

function Composer({ value, onChange, onSend }) {
  return (
    <div className="border-t border-dd-border bg-dd-surface p-3">
      <div className="flex items-end gap-2 rounded-dd-lg border border-dd-border bg-dd-surface-2 p-2 focus-within:border-dd-accent focus-within:shadow-dd-focus">
        <IconButton icon="attach_file" label="Attach file" />
        <Textarea
          aria-label="Message"
          placeholder="Message the selected model…"
          rows={1}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          className="field-sizing-content max-h-40 min-h-10 resize-none border-0 bg-transparent py-2 shadow-none hover:border-0 focus:border-0 focus:shadow-none"
        />
        <Button
          variant="primary"
          icon="send"
          disabled={!value.trim()}
          onClick={onSend}
          className="shrink-0"
        >
          Send
        </Button>
      </div>
      <p className="mt-2 text-center text-xs text-dd-subtle">
        Responses may be inaccurate. Verify provider output before use.
      </p>
    </div>
  );
}

/** Mocked chat surface for testing provider-backed models through DurinDoor's local /v1 endpoint. */
export default function PlaygroundPage({
  messages = [],
  composer = "",
  streaming = false,
  onComposerChange,
  onSuggestionClick,
  onClear,
  onSend,
}) {
  const [model, setModel] = useState(MODEL_OPTIONS[0].value);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon="forum"
        title="Playground"
        subtitle="Test models through the local OpenAI-compatible endpoint"
      />
      <section className="flex min-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface shadow-dd-elevated">
        <Toolbar model={model} onModelChange={setModel} onClear={onClear} />
        {messages.length === 0 ? (
          <EmptyPlayground onSuggestionClick={onSuggestionClick} />
        ) : (
          <Conversation messages={messages} model={model} streaming={streaming} />
        )}
        <Composer value={composer} onChange={onComposerChange} onSend={onSend} />
      </section>
    </div>
  );
}
