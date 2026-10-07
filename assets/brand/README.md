# DurinDoor identity

DurinDoor takes its name from Durin's Door at Moria. The visual language uses a vaulted gate, an open leaf, a guiding star, silver tree engravings, moonlit stone, and emerald light. Keep the emblem simple at small sizes; reserve the detailed gate illustration for large imagery.

## Logo files

`durindoor-mark.svg` is the standalone emblem. `durindoor-app-icon.svg` puts it on dark stone. The dark, light, and monochrome logo SVGs include the wordmark as paths, with no font dependencies. The identity board is a presentation reference; use the SVG files for production logos.

Preserve the proportions. Leave at least one pillar width of clear space around the mark. Use the dark wordmark on forest or stone, the light wordmark on chalk, and monochrome for one-color reproduction. Do not add gradients, shadows, or extra symbols to the logo itself.

## Color

| Role | Color |
| --- | --- |
| Emerald, brand and primary actions | `#10B981` |
| Deep forest, atmospheric backgrounds | `#071D16` |
| Moon silver, lettering and mithril | `#EEEAE4` |
| Stone, neutral dark material | `#171719` |
| Deep emerald, accessible actions on light docs | `#066247` |

## Typography

Cormorant Garamond is the display and wordmark face. Space Grotesk is the UI and documentation face. Both are locally served from `website/public/home/fonts/` with their SIL Open Font License files. Logo lettering is outlined from Cormorant Garamond at weight 600.

Font sources: [Cormorant Garamond](https://github.com/google/fonts/tree/main/ofl/cormorantgaramond) and [Space Grotesk](https://github.com/google/fonts/tree/main/ofl/spacegrotesk).

## Image and motion

The gateway campaign illustration and identity board use the built-in image generation tool. The prompts are retained in `prompts.md`. The logo is an editable SVG emblem, and lettering is outlined from the actual font, independent of the generated board.

The website uses emerald mist shaders, pointer parallax, scroll reveals, and magnetic controls. Reduced motion uses the static gateway illustration. WebGL is optional; content and navigation work without it. The public site uses a dark fantasy palette, while docs support light and dark reading modes.

The website copies this folder to `/brand` during `predev` and `prebuild`. Update canonical files here, then run `node website/scripts/sync-public.mjs`.
