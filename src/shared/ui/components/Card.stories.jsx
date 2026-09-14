/**
 * Durin DS — Card stories (group: Surfaces).
 *
 * Covers named density, the full CardHeader + CardContent + CardFooter
 * composition, narrow wrapping with long text/actions, and a realistic
 * provider card. Stories set no backgrounds — the "Theme" toolbar toggle
 * drives dark/light.
 */
import { Card, CardHeader, CardContent, CardFooter } from "./Card.jsx";
import { Badge } from "./Badge.jsx";
import { StatusDot } from "./StatusDot.jsx";
import { Chip } from "./Chip.jsx";

const meta = {
  title: "Durin DS/Surfaces/Card",
  component: Card,
  parameters: { layout: "centered" },
};

export default meta;

/** Controls-driven single card. */
export const Playground = {
  args: {
    padding: "md",
    hover: false,
  },
  render: (args) => (
    <Card {...args} className="w-80">
      <p className="text-[13px] text-dd-text">
        One endpoint for all your AI providers. Manage keys, monitor usage, and
        scale effortlessly.
      </p>
      <p className="mt-2 text-xs text-dd-muted">Simple card with default padding.</p>
    </Card>
  ),
};

/** Every named density uses the canonical Card padding scale. */
export const NamedDensity = {
  render: () => (
    <div className="grid w-80 gap-3">
      {["none", "xs", "sm", "md", "lg"].map((padding) => (
        <Card key={padding} padding={padding}>
          <div className="bg-dd-surface-2 text-xs text-dd-muted">padding=&quot;{padding}&quot;</div>
        </Card>
      ))}
    </div>
  ),
};

/** Keep the 24rem desktop composition, bounded by the centered canvas on mobile. */
export const Composed = {
  render: () => (
    <Card padding={false} className="w-96 max-w-full">
      <CardHeader
        icon="key"
        title="API keys"
        subtitle="3 active keys"
        actions={
          <>
            <button
              type="button"
              aria-label="Key settings"
              className="-m-2 inline-flex size-11 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">
                settings
              </span>
            </button>
            <button
              type="button"
              className="ml-auto min-h-11 rounded-dd bg-dd-accent px-2.5 text-xs font-medium text-dd-on-accent outline-none transition-colors hover:bg-dd-accent-hover focus-visible:shadow-dd-focus"
            >
              New key
            </button>
          </>
        }
      />
      <CardContent className="flex flex-col gap-2">
        <p className="text-[13px] text-dd-text">
          Keys authenticate CLI tools against your DurinDoor instance.
        </p>
        <p className="font-mono text-xs text-dd-muted">sk-••••-••••-9f2c</p>
      </CardContent>
      <CardFooter>
        <span className="text-xs text-dd-muted">Last used 2h ago</span>
        <button
          type="button"
          className="ml-auto min-h-11 rounded-dd px-2.5 text-xs font-medium text-dd-accent outline-none transition-colors hover:text-dd-accent-hover focus-visible:shadow-dd-focus"
        >
          View all
        </button>
      </CardFooter>
    </Card>
  ),
};

/** Long labels and multiple 44px actions wrap within a narrow card. */
export const NarrowHeaderActions = {
  render: () => (
    <Card padding={false} className="w-56">
      <CardHeader
        icon="settings"
        title="A deliberately long provider configuration title"
        subtitle="Long metadata remains readable without clipping or widening the page."
        actions={
          <>
            <button type="button" className="min-h-11 rounded-dd px-3 text-xs text-dd-accent outline-none focus-visible:shadow-dd-focus">
              Test connection
            </button>
            <button type="button" className="min-h-11 rounded-dd bg-dd-accent px-3 text-xs text-dd-on-accent outline-none focus-visible:shadow-dd-focus">
              Save changes
            </button>
          </>
        }
      />
      <CardContent>
        <p className="text-[13px] text-dd-text">https://provider.example.com/a/very/long/unbroken/configuration/path</p>
      </CardContent>
    </Card>
  ),
};

/** `hover` raises the border on pointer-over — for linked/clickable cards. */
export const Hoverable = {
  render: () => (
    <div className="flex w-[35rem] max-w-full flex-wrap gap-4">
      {["OpenAI", "Anthropic", "Gemini"].map((name) => (
        <Card key={name} hover className="w-44 max-w-full cursor-pointer">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-dd-text">{name}</span>
            <span className="text-xs text-dd-muted">Hover me</span>
          </div>
        </Card>
      ))}
    </div>
  ),
};

/** Realistic composition: icon tile + name + live StatusDot + Badge/Chip rows + metric footer. */
export const ProviderCard = {
  render: () => (
    <Card padding={false} hover className="w-96 max-w-full">
      <CardHeader
        icon="database"
        title="OpenAI"
        subtitle="api.openai.com"
        actions={<StatusDot tone="success" pulse label="Live" />}
      />
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="success" icon="check_circle">
            Healthy
          </Badge>
          <Badge tone="accent" icon="bolt">
            Default
          </Badge>
          <Badge tone="neutral">5 models</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip size="sm" icon="smart_toy" label="gpt-5" selected />
          <Chip size="sm" icon="smart_toy" label="gpt-5-mini" />
          <Chip size="sm" icon="image" label="gpt-image-1" />
        </div>
      </CardContent>
      <CardFooter>
        <span className="dd-tnum text-xs text-dd-muted">1.2M tokens / 24h</span>
        <span className="dd-tnum text-xs text-dd-subtle">·</span>
        <span className="dd-tnum text-xs text-dd-muted">$3.41</span>
        <button
          type="button"
          className="ml-auto min-h-11 rounded-dd px-2.5 text-xs font-medium text-dd-accent outline-none transition-colors hover:text-dd-accent-hover focus-visible:shadow-dd-focus"
        >
          Configure
        </button>
      </CardFooter>
    </Card>
  ),
};
