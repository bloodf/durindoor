---
name: DurinDoor
description: "Moonlit stone, silver engraving and emerald light for a self-hosted AI gateway."
colors:
  emerald: "#10b981"
  emerald-light: "#6ee7b7"
  action-ink: "#032a1a"
  stone: "#0c1410"
  stone-raised: "#111d16"
  panel: "#17231b"
  silver: "#eeeae4"
  muted: "#adbbb0"
  line: "#ffffff14"
  line-strong: "#ffffff28"
  docs-paper: "#f7f5f0"
  docs-surface: "#efede6"
  docs-surface-secondary: "#e7e4dc"
  docs-ink: "#242e28"
  docs-muted: "#56635b"
  docs-border: "#d5dcd2"
  docs-emerald: "#066247"
  docs-emerald-hover: "#034b36"
  docs-on-emerald: "#f1fff9"
  docs-accent-soft: "#0662470d"
  docs-dark-secondary: "#1c2a21"
  docs-dark-border: "#ffffff21"
  docs-dark-accent-hover: "#a7f3d0"
  docs-dark-accent-soft: "#6ee7b712"
typography:
  display:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "clamp(64px, 7.1vw, 96px)"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "clamp(40px, 4.8vw, 64px)"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "32px"
  body:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "16px"
    lineHeight: 1.6
  lead:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "18px"
    lineHeight: 1.65
  label:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  code:
    fontFamily: "ui-monospace, SFMono-Regular, JetBrains Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
  docs-title:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "48px"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.025em"
  docs-index-title:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "60px"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.025em"
  docs-body:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "16px"
    lineHeight: 1.8
rounded:
  button: "7px"
  code: "8px"
  kind-card: "10px"
  panel: "12px"
  demo: "14px"
  gate-control: "30px"
  docs-inline-code: "4px"
  docs-control: "7px"
  docs-code: "10px"
  docs-panel: "12px"
spacing:
  compact: "12px"
  inset: "24px"
  feature-inset: "28px"
  generous: "32px"
  section-mobile: "68px"
  section: "100px"
components:
  button-primary:
    backgroundColor: "{colors.emerald}"
    textColor: "{colors.action-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.emerald-light}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.silver}"
    rounded: "{rounded.button}"
    padding: "12px 20px"
  feature-card:
    backgroundColor: "{colors.stone-raised}"
    textColor: "{colors.silver}"
    rounded: "{rounded.panel}"
    padding: "{spacing.feature-inset}"
  code-block:
    rounded: "{rounded.code}"
  docs-button-primary:
    backgroundColor: "{colors.docs-emerald}"
    textColor: "{colors.docs-on-emerald}"
    typography: "{typography.label}"
    rounded: "{rounded.docs-control}"
    padding: "11px 16px"
  docs-button-primary-dark:
    backgroundColor: "{colors.emerald-light}"
    textColor: "{colors.action-ink}"
  docs-setup-step:
    backgroundColor: "{colors.docs-surface}"
    textColor: "{colors.docs-ink}"
    padding: "{spacing.inset}"
  demo-window:
    rounded: "{rounded.demo}"
    height: "720px"
---

# Design System: DurinDoor

## Overview

**Creative North Star: "The Moonlit Gateway"**

Carved stone, silver engraving and emerald light make the gateway an invitation. Cormorant Garamond gives the public identity its inscription-like voice; Space Grotesk keeps controls and technical explanations direct. The door is the expressive signature, while supporting sections use legible text and restrained diagrams.

The marketing surface is dark and spacious. Soft emerald gradients explain real mechanisms through asymmetric compositions. Documentation shares the wordmark, local fonts and emerald accent, with parchment reading surfaces in light mode and forest stone in dark mode. Its opening uses the established static engraved gate, an ordered setup strip and a compact guide directory. The production dashboard retains its own functional design system, including inside the browser-mocked demo.

**Key Characteristics:**

- Moonlit stone with silver type and emerald emphasis.
- Locally served serif displays and sans-serif controls.
- A perspective stone gate with extruded arched leaves, moonlit inscriptions and a static fallback.
- Mechanism illustrations beside a real interactive dashboard.

## Colors

The normative palette above belongs to the public marketing and documentation surfaces, not the production dashboard token system.

### Primary

- **Emerald:** action fills, active routes and mechanism emphasis.
- **Emerald Light:** italic hero emphasis, gateway mark, diagram strokes and action hover.
- **Docs Emerald:** readable links and active navigation on the light documentation surface.

### Neutral

- **Stone / Stone Raised / Panel:** background, alternating sections and inset containers.
- **Silver:** primary copy and display inscriptions.
- **Action Ink:** dark text on emerald primary actions; this reflects the inherited important declaration in the actual CSS cascade.
- **Muted:** supporting explanations, footer links and notes.
- **Line / Line Strong:** quiet separators and interactive container borders.
- **Docs Paper / Docs Surface / Docs Surface Secondary:** parchment canvas, sidebar and inset panels, then inline-code and secondary surfaces.
- **Docs Ink / Docs Muted / Docs Border:** forest-tinted foreground, readable supporting copy and quiet separators in light mode.
- **Docs Emerald / Docs Emerald Hover / Docs On Emerald / Docs Accent Soft:** light-mode links and actions, their hover state, action text and subtle active backgrounds. The focus ring uses Docs Emerald.
- **Dark documentation:** Stone is the canvas; Stone Raised is the sidebar and panel surface; Docs Dark Secondary is the secondary inset. Silver and Muted carry text. Emerald Light is the action, link and focus accent with Action Ink on filled actions. Docs Dark Border, Docs Dark Accent Hover and Docs Dark Accent Soft define separators and state feedback.

**The Readable Mechanism Rule.** Use light and diagrams to explain implemented behavior; preserve readable copy and truthful support boundaries.

## Typography

**Display Font:** locally served Cormorant Garamond, with Georgia and serif fallback.
**Body Font:** locally served Space Grotesk, with system sans-serif fallback.
**Label/Mono Font:** the system monospace stack in the code token; it is not a downloaded font.

The serif gives headlines the character of a carved inscription; sans-serif copy carries the technical argument. Both local fonts use swap loading and their available variable weight range (300–700).

### Hierarchy

- **Display:** the hero headline; its final word is emerald, italic and lighter (400).
- **Headline:** section and closing headings; balanced wrapping keeps long titles readable.
- **Title:** feature headings. Kind-card headings use a smaller display size (28px).
- **Body:** supporting text and controls. Section leads use a larger size (17px) and line height (1.65); hero copy uses the lead token with a maximum width (470px).
- **Label:** buttons and compact actions. Desktop navigation is smaller (12px).
- **Code:** commands and mechanism labels. The closing terminal command is larger (23px).

Documentation uses the same local families with its own reading hierarchy. Article h1 uses the docs-title token; the index uses docs-index-title, stepping to 48px at 1100px and 44px at 760px. Article h1 steps to 40px at 760px. Article prose uses docs-body with a 72ch measure, falling to 15px on mobile; descriptions use 17px/1.7 and 68ch. Sans-serif article h2 uses 25px/1.3 with 2.5em top spacing and 0.8em bottom spacing; h3 uses 20px/1.4. Code uses a system monospace stack, with block text at 13px/1.75. Do not propagate marketing display sizes into dashboard tables or forms.

## Layout

Marketing containers cap at 1280px and use fluid inline padding (`clamp(24px, 4vw, 64px)`). Desktop sections use the section spacing token; at 800px and below they use section-mobile. The fixed navigation is 76px high, and the hero accounts for it.

The gateway canvas and its static poster cover the entire hero behind the content. The desktop content grid uses two columns (1fr / 1.05fr), placing copy to the left and the gate control to the right; the perspective doorway shifts right with the canvas aspect ratio. A stone gradient scrim protects copy and actions while leaving the gateway visible. The content area has a minimum height of the larger of 760px or the viewport minus the navigation, stepping to 690px at 1100px. At 800px and below, copy and the gate-control area stack, the scrim becomes vertical, and the scene places the doorway below the copy. The control area height steps from 700px to 620px at 1100px, 540px at 800px and 460px at 480px; these heights do not constrain the hero-wide canvas. Narrow hero typography uses `clamp(62px, 11vw, 88px)`.

The feature bento has six columns with 18px gaps: MCP and tunnels span four; realtime and proxy traces span two. At 800px it becomes two columns, with the broad cards spanning both. At 560px all cards occupy one column. Mechanism labels may simplify on narrow screens; substantive descriptions remain visible.

The real dashboard preview follows the hero directly. Its iframe is fluid-width and 720px high, with the production responsive layout inside. Quick-start rows and the final CTA stack at 800px. Footer groups use three columns, falling to two at 480px. Use the footer's useful link groups and compact copyable terminal ending as actual navigation and setup aids.

Section docs buttons sit 28px below their preceding content. Provider facts use 18px insets and 14px gaps; below 480px they stack with 16px insets. The request diagram follows tools → gateway → providers, stacking in the same order below 800px. Combo fallback uses a labeled configuration example. Inside the demo drawer, only the route list scrolls; the brand and Settings stay visible.

Documentation preserves the Fumadocs sidebar, search, breadcrumb, page TOC and previous/next navigation. The index omits the duplicate root title and description, breadcrumb and TOC. Its hero pairs copy with a static gate image in a 1.25fr / 1fr grid, with a 40px gap, 36px bottom inset and separator. The heading caps at 12ch and the pitch at 46ch. At 1100px the gap becomes 24px. At 760px the layout becomes one column and the decorative gate is hidden; setup, reference and search remain available.

The installation/provider/first-request sequence is a joined three-column strip with 24px step insets and visible sequential labels. Guide directory links are flat rows in two columns with a 36px gap, 22px vertical padding and bottom separators. Popular links also use two columns. At 760px these patterns become one column, and setup separators switch from vertical to horizontal. Use destination labels and descriptions rather than duplicate chapter counts.

## Elevation & Depth

Depth comes from stone-tone layering, carved artwork, translucent navigation and restrained emerald gradients. The primary button is flat at rest; hover adds a soft emerald shadow. The dashboard frame uses a diffuse black shadow to separate actual product proof from the marketing surface.

Documentation uses flat tonal layering, borders and a static image; code blocks explicitly have no shadow. Sidebar and subnav use the docs surface, and the 56px subnav has no backdrop blur.

### Shadow Vocabulary

- **Action hover:** `0 8px 30px #10b98120`.
- **Demo frame:** `0 28px 80px #0005`.
- **Tunnel packet:** `0 0 12px #6ee7b7`, limited to the tiny mechanism indicator.

**The Quiet Proof Rule.** Keep the real dashboard visually faithful to its production components; use marketing depth around its frame.

## Shapes

Panels use gently curved corners, with smaller button and code corners and a rounder gate control. Keep thin borders legible against stone surfaces. The gate's tall arch, carved leaves and silver engraving establish the signature silhouette; feature diagrams use simpler branches, trace rows and connection paths.

Documentation uses 7px corners for actions, search and theme controls; 12px for cards, the joined setup strip and the gate image; 10px for code containers; and 4px for inline code and keyboard hints. Directory rows stay flat with bottom separators. The gateway mark carries the brand between surfaces.

## Components

### Buttons

Primary actions use emerald fills, compact rectangular corners and a minimum height (44px). Ghost actions use transparent fills with stronger thin borders. Both keep the local sans-serif label. Focus uses an emerald outline (2px) offset by 3px. Preserve source hover treatments; active actions remain recognizable without motion.

### Copy controls and commands

Copy controls are small bordered buttons beside selectable monospace commands. They acknowledge success through their label. The hero's install command is a quiet single-line row; quick-start code uses an inset container; the closing command remains compact rather than becoming a decorative terminal window.

### Navigation

The fixed nav uses dark translucent stone with blur (16px), a serif wordmark and small sans-serif links. Narrow layouts use the existing menu interaction and preserve the demo/docs actions. Footer links remain grouped by product, documentation and repository destinations.

### Feature cards

Each card is a full link to matching docs. Its diagram explains MCP transports/tools, text realtime, proxy traces or tunnel connections. Emerald depth is differentiated by mechanism. A subtle brightness change accompanies hover; the text and diagrams are present by default.

### Gateway door

Two thick extruded arched slabs pivot about their outer hinges toward the viewer in perspective. Procedural stone and moonlit inscriptions define their faces; opening reveals four recessed passage arches, a stone floor and emerald light beyond. Scroll progress opens the leaves until the explicit Open/Close control overrides it; both inputs use the same smoothed opening state. The frame remains fixed within the scene, with bounded pointer parallax, threshold mist and particles around it. The hero-wide canvas replaces the static poster after the first submitted frame, independently of scroll; only then does the Open/Close control become available. Rendering pauses outside the hero and in hidden tabs. The static gateway artwork sits below the canvas until readiness and stays visible when reduced motion is requested, WebGL is unavailable or the canvas fails/loses context. The control disappears when animation is unavailable. Treat the artwork as decorative; the hero heading and actual action labels carry its meaning.

### Real dashboard preview

The `/demo-preview` embed reuses production DashboardLayout and EndpointPageClient with browser mock data. Keep its production controls, responsive behavior and theme intact. State that data is mocked. The surrounding heading and frame are marketing components; the application inside is product proof.

### Documentation opening and navigation

The index presents the documentation title, OpenAI and Anthropic API coverage, setup and reference actions, and search beside the established static gate artwork. The gate is hidden at 760px and below. The three setup links are ordered install/sign-in, connect a provider, then send a request; directory rows pair an emerald icon with a title, description and external-direction arrow. Preserve Fumadocs navigation and article controls, active sidebar/TOC emphasis, selectable code and copy controls. Use real connected model IDs in examples and keep registry and chapter counts out of the opening.

Documentation actions use theme-scoped emerald fills and contrasting text; hover uses the theme accent-hover. Ghost actions keep a thin docs border. Interactive focus is a 2px accent outline offset by 3px. Link and button state transitions use 160ms ease and stop for reduced motion.

### Motion and visibility

The door owns the entrance motion. Its first rendered frame reveals the canvas without requiring scroll; scroll changes the opening state. Supporting content is visible by default. Caret blinking (1.4s) and tunnel packets (3s) provide small mechanism cues. Reduced-motion CSS disables marketing animation, transitions and smooth scrolling; the gate switches to static artwork.

## Do's and Don'ts

### Do:

- **Do** use the emerald accent for actions, active routes and restrained mechanism light.
- **Do** use local Cormorant Garamond for marketing displays and Space Grotesk for body text.
- **Do** keep the demo visually faithful to the production dashboard and identify its browser-mocked data.
- **Do** keep content visible before animation and preserve the static door fallback.
- **Do** qualify provider modality support and show OpenAI and Anthropic protocol coverage.
- **Do** preserve grouped footer links, copyable install commands and responsive grids.
- **Do** keep docs prose readable at 72ch, retain Fumadocs controls, and preserve the setup sequence and guide links on mobile.

### Don't:

- **Don't** add localhost or endpoint addresses to the marketing hero.
- **Don't** replace the live dashboard preview with a fabricated marketing dashboard.
- **Don't** imply every provider supports every modality, or describe text realtime as audio support.
- **Don't** expose an inactive door control when reduced motion, missing WebGL or context loss prevents animation.
- **Don't** gate supporting content behind scroll reveals or apply the fantasy styling to production dashboard components.
- **Don't** duplicate the docs index title, add chapter counts, or turn its static gate into an additional reading-page animation.
