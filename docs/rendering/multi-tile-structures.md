# Multi-Tile Structure Rendering

Procedural buildings are represented by `MapProp.kind === 'proc-building'`.
The prop stores its top-left coordinate plus footprint metadata such as `w`,
`h`, `levels`, roof parameters, and wall/roof colors. Data helpers stamp the
covered tiles as `structure` terrain and add the matching prop.

## Current Behavior

- Structure tiles provide terrain cost, passability, and cover data.
- The renderer draws the procedural building walls and roof over the footprint.
- Missing terrain texture labels stay enabled for normal terrain debugging.
- A `structure.png` label is suppressed when that tile is covered by a
  `proc-building` footprint, so external texture mode does not spam labels
  under buildings.

## Source Anchors

- `packages/core/src/simulation/types.ts`: `MapProp`, `PropKind`.
- `packages/data/src/city-battlefields.ts`: generated city building props.
- `packages/data/src/index.ts`: starter scenario building props.
- `apps/web/src/components/BattlefieldStage.tsx`: footprint coverage,
  missing-texture labels, and procedural building drawing.

## Invariants

- A procedural building footprint must only suppress the missing texture label
  for its own covered `structure` tiles.
- Missing labels for other terrain types should remain visible in external
  texture mode.
- Footprints may be clipped at map bounds; out-of-bounds cells are ignored.
- The prop, not a terrain filename, remains the source of the visible building.
