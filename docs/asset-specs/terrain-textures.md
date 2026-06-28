# Terrain Texture Asset Spec

Runtime path: `apps/web/public/textures/terrain/`

The tactical renderer draws a solid terrain color first, then blends a small
neutral detail texture over each tile. These textures must be subtle overlays,
not full-color terrain paintings.

## Required Files

- `plain.png`
- `road.png`
- `forest.png`
- `urban.png`
- `hill.png`
- `water.png`
- `swamp.png`
- `structure.png`

Optional variants may use `_0` through `_3` suffixes, for example
`plain_0.png` and `plain_1.png`. Keep the base filename present even when
variants exist.

## Format

- PNG, RGBA, sRGB, 8-bit.
- 32x32 px preferred; 64x64 px is acceptable when the pattern still reads well.
- Seamless on both axes.
- Transparent background where no detail is needed.
- Grayscale or near-black detail only.
- No embedded labels, logos, icons, directional lighting, or baked shadows.
- Low contrast, no obvious tiling grid, no large blobs that shimmer at zoom.

## Pattern Notes

| Terrain | Texture direction |
| --- | --- |
| `plain` | Sparse grass flecks and short fine strokes. |
| `road` | Fine grain and shallow lengthwise scuffs, no road edges. |
| `forest` | Leaf litter, twigs, and organic speckles, denser than `plain`. |
| `urban` | Concrete/asphalt micro-noise, no visible paving grid. |
| `hill` | Slightly rougher stone-and-grass speckles, still subtle. |
| `water` | Tiny ripple marks with no bright highlights. |
| `swamp` | Irregular organic spots and muddy grain. |
| `structure` | Harder concrete/plaster grain for artificial surfaces. |

## Acceptance

- Tiling four copies in a 2x2 block must show no edge seam.
- The texture must not shift the terrain hue by itself.
- The pattern must remain readable at normal battle zoom without dominating
  units, props, targeting overlays, or fog of war.
