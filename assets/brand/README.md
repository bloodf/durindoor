# Brand asset maintenance

The [DurinDoor brand guide](../../docs/contributing/brand-guide.mdx) is the canonical guide for logo use, current public colors, typography, motion, and future dashboard work. Keep brand rules there rather than duplicating a palette in this file.

This directory owns the original logo SVGs, application icon, gateway illustration, identity board, and generated raster assets. Wordmark lettering is outlined from Cormorant Garamond at weight 600. The board is a presentation reference; production logos use the SVG originals.

Image-generation prompts are retained in `prompts.md`. Local public font files and their SIL Open Font License notices live in `website/public/home/fonts/`. Dashboard Inter files live in `public/fonts/`.

After changing a canonical asset, run these commands from the repository root:

```bash
node scripts/sync-brand-assets.mjs
node website/scripts/sync-public.mjs
```

The first command renders the existing project asset filenames and requires website dependencies for SVG rasterization. The second refreshes generated website assets, including the `/brand` copy. The website also runs the copy during `predev` and `prebuild`. Edit originals here, not the generated website copies.
