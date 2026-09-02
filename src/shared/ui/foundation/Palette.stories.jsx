import { useEffect, useState } from "react";

/**
 * Durin DS — Foundation proof story.
 *
 * Renders every `--dd-*` token as a swatch grid (surfaces, text, accent,
 * status) plus shape/elevation demos and a typography specimen. It exists to
 * prove that `tokens.css`, the Inter font faces and the "Theme" toolbar
 * toggle (dark/light via `.dark` on <html>) all work together. Component
 * authors: copy the patterns used here — `*-dd-*` utilities only, never
 * hardcoded hex values.
 *
 * Class names are written as full literal strings on purpose: Tailwind v4
 * scans source text for candidates, so interpolated class names would not
 * generate any CSS.
 */

/** Resolved value of a CSS custom property, re-read after each theme flip. */
function useResolvedVar(token, theme) {
  const [value, setValue] = useState("");
  useEffect(() => {
    // rAF: run after the decorator's effect has toggled `.dark` and painted.
    const frame = requestAnimationFrame(() => {
      setValue(
        getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [token, theme]);
  return value;
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-dd-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Swatch({ token, cls, theme }) {
  const value = useResolvedVar(token, theme);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className={`h-16 w-full rounded-dd border border-dd-border ${cls}`} />
      <div className="flex flex-col">
        <span className="text-sm font-medium text-dd-text">{cls}</span>
        <span className="font-mono text-xs text-dd-muted">{token}</span>
        <span className="dd-tnum font-mono text-xs text-dd-subtle">{value}</span>
      </div>
    </div>
  );
}

function SwatchGrid({ items, theme }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <Swatch key={item.cls} {...item} theme={theme} />
      ))}
    </div>
  );
}

const SURFACES = [
  { token: "--dd-bg", cls: "bg-dd-bg" },
  { token: "--dd-bg-alt", cls: "bg-dd-bg-alt" },
  { token: "--dd-surface", cls: "bg-dd-surface" },
  { token: "--dd-surface-2", cls: "bg-dd-surface-2" },
  { token: "--dd-surface-3", cls: "bg-dd-surface-3" },
];

const BORDERS = [
  { token: "--dd-border", cls: "bg-dd-border" },
  { token: "--dd-border-subtle", cls: "bg-dd-border-subtle" },
];

const TEXT = [
  { token: "--dd-text", cls: "bg-dd-text" },
  { token: "--dd-text-muted", cls: "bg-dd-muted" },
  { token: "--dd-text-subtle", cls: "bg-dd-subtle" },
];

const ACCENT = [
  { token: "--dd-accent", cls: "bg-dd-accent" },
  { token: "--dd-accent-hover", cls: "bg-dd-accent-hover" },
  { token: "--dd-accent-soft", cls: "bg-dd-accent-soft" },
  { token: "--dd-accent-2", cls: "bg-dd-accent-2" },
  { token: "--dd-accent-2-hover", cls: "bg-dd-accent-2-hover" },
  { token: "--dd-accent-2-soft", cls: "bg-dd-accent-2-soft" },
  { token: "--dd-on-accent", cls: "bg-dd-on-accent" },
];

const STATUS = [
  { token: "--dd-success", cls: "bg-dd-success" },
  { token: "--dd-warning", cls: "bg-dd-warning" },
  { token: "--dd-danger", cls: "bg-dd-danger" },
  { token: "--dd-info", cls: "bg-dd-info" },
];

function RadiusAndElevation() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div className="flex h-20 items-center justify-center rounded-dd border border-dd-border bg-dd-surface">
        <span className="font-mono text-xs text-dd-muted">rounded-dd</span>
      </div>
      <div className="flex h-20 items-center justify-center rounded-dd-lg border border-dd-border bg-dd-surface">
        <span className="font-mono text-xs text-dd-muted">rounded-dd-lg</span>
      </div>
      <div className="flex h-20 items-center justify-center rounded-dd-lg bg-dd-surface shadow-dd-elevated">
        <span className="font-mono text-xs text-dd-muted">shadow-dd-elevated</span>
      </div>
      <div className="flex h-20 items-center justify-center rounded-dd bg-dd-surface shadow-dd-focus">
        <span className="font-mono text-xs text-dd-muted">shadow-dd-focus</span>
      </div>
    </div>
  );
}

function AccentOnAccent({ theme }) {
  const accent = useResolvedVar("--dd-accent", theme);
  return (
    <div className="flex items-center gap-4 rounded-dd-lg border border-dd-border bg-dd-surface p-4">
      <button
        type="button"
        className="rounded-dd bg-dd-accent px-4 py-2 text-sm font-semibold text-dd-on-accent"
      >
        Primary action
      </button>
      <span className="rounded-dd bg-dd-accent-soft px-3 py-1 text-sm font-medium text-dd-accent">
        Soft badge
      </span>
      <span className="dd-tnum font-mono text-xs text-dd-subtle">{accent}</span>
    </div>
  );
}

const meta = {
  title: "Durin DS/Foundation",
  parameters: { layout: "padded" },
};

export default meta;

export const Palette = {
  render: (_args, context) => {
    const theme = context.globals.theme === "light" ? "light" : "dark";
    return (
      <div className="flex max-w-5xl flex-col gap-8 bg-dd-bg p-6 text-dd-text">
        <Section title="Surfaces & backgrounds">
          <SwatchGrid items={SURFACES} theme={theme} />
        </Section>
        <Section title="Borders">
          <SwatchGrid items={BORDERS} theme={theme} />
        </Section>
        <Section title="Text">
          <SwatchGrid items={TEXT} theme={theme} />
        </Section>
        <Section title="Accent">
          <p className="dd-tnum text-xs text-dd-muted">Brand emerald (logo) = primary interactive; gold = secondary/highlights</p>
          <SwatchGrid items={ACCENT} theme={theme} />
          <AccentOnAccent theme={theme} />
        </Section>
        <Section title="Status">
          <SwatchGrid items={STATUS} theme={theme} />
        </Section>
        <Section title="Radius & elevation">
          <RadiusAndElevation />
        </Section>
      </div>
    );
  },
};

export const Typography = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-8 bg-dd-bg p-6 text-dd-text">
      <Section title="Headings — Inter semibold">
        <div className="flex flex-col gap-2">
          <span className="text-3xl font-semibold text-dd-text">
            The mines of Moria — 30px
          </span>
          <span className="text-2xl font-semibold text-dd-text">
            The mines of Moria — 24px
          </span>
          <span className="text-xl font-semibold text-dd-text">
            The mines of Moria — 20px
          </span>
        </div>
      </Section>
      <Section title="Body — Inter regular">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-dd-text">
            14px — One endpoint for all your AI providers. Manage keys, monitor
            usage, and scale effortlessly.
          </p>
          <p className="text-[13px] text-dd-muted">
            13px — One endpoint for all your AI providers. Manage keys, monitor
            usage, and scale effortlessly.
          </p>
          <p className="text-xs text-dd-subtle">
            12px — One endpoint for all your AI providers. Manage keys, monitor
            usage, and scale effortlessly.
          </p>
        </div>
      </Section>
      <Section title="Metrics — .dd-tnum tabular figures">
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Requests", value: "1,234,567" },
            { label: "Tokens", value: "98,765,432" },
            { label: "Cost", value: "$1,011.12" },
          ].map((metric) => (
            <div
              key={metric.label}
              className="flex flex-col gap-1 rounded-dd border border-dd-border bg-dd-surface p-4"
            >
              <span className="text-xs text-dd-muted">{metric.label}</span>
              <span className="dd-tnum text-xl font-semibold text-dd-text">
                {metric.value}
              </span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Mono stack">
        <pre className="rounded-dd border border-dd-border bg-dd-surface-2 p-4 font-mono text-[13px] text-dd-text">
          {"provider/model → openai → claude\ntranslateRequest(req, \"gemini\", \"openai\")"}
        </pre>
      </Section>
    </div>
  ),
};
