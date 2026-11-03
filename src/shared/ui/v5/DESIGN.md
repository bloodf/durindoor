---
name: "DurinDoor v5 admin review"
description: "Source-backed Storybook design direction, pending acceptance."
colors:
  canvas: "#f5f7f5"
  surface: "#ffffff"
  text: "#172a20"
  accent: "#17623f"
  info: "#235e43"
  dark-canvas: "#111a15"
  dark-surface: "#1b2921"
  dark-text: "#edf5ed"
  dark-accent: "#9cd9b0"
  dark-info: "#b6d6c0"
---

# Design System: DurinDoor v5 admin review

The active implementation uses `review.css` and source-backed components. The
previous `v5.css` describes the rejected generic prototype, preserved under
Archive. It is not the active design specification.

The active direction uses Inter, green actions and forest-neutral light/dark
surfaces. `review.css` is the token source, including information states, focus,
selection and portaled dialogs. Warning and destructive states retain distinct
semantic colors and readable labels. Provider logos keep their original artwork.

The existing dashboard shell keeps task groups, resource headings, theme,
language and account controls. The review bar exposes scenario discovery and
identifies synthetic operations. Page-specific fields and handlers come from
actual components rather than generic form schemas.

Usage is composed into seven independent widgets. Draft order, names, widths
and visibility commit through Save layout; Cancel restores the saved layout.
Pointer drag, keyboard drag and move buttons provide equivalent ordering paths.
Narrow viewports stack widgets and keep wide tables and period controls in local
scroll regions. Usage reset and layout reset have separate confirmation flows.

Forms keep domain labels, validation, conditional fields, disabled states and
pending feedback. The Storybook native-select boundary uses the shared themed
Select while retaining successful native form serialization and required
validation. Existing modal components retain their focus and dismissal behavior.

This is a review direction awaiting the user's acceptance. Source reuse and
scoped styling do not prove every page has received a complete visual redesign.
Runtime, responsive and accessibility evidence is recorded separately under
`.impeccable/review/v5/`; no live backend or release claim follows from this record.
