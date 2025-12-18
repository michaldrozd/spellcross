# Prompt Update: Runtime Multi-tile Buildings Without Placeholder Spam

## Objective
We already render procedurally generated multi-tile buildings (walls/roofs) over blocks of `structure` tiles. However, every structure tile still shows `structure.png` debug text because we enable external textures (`?textures=external`) while `/textures/terrain/structure.png` is missing. The goal is to suppress these per-tile labels when a `proc-building` prop covers that footprint, so the scene only shows the building polygon (no repeated "structure.png" text).

## Current Status
- **Core**: `MapProp.kind` has `'proc-building'` plus metadata (`w,h,levels,roof*`). Helpers (`addProcBuildingRect`) stamp structure tiles and add the prop.
- **Renderer** (`BattlefieldStage.tsx`):
  - `terrainMissingTexts` prints missing terrain PNG names when `allowExternalTextures` is enabled.
  - `procBuildings` draws walls and roofs with Pixi Graphics on top of the footprint.
  - `tileGraphics` still tries to draw the terrain overlay, so missing PNGs produce `terrainMissingTexts`.
- **Visual issue**: With `?textures=external`, each structure tile displays "structure.png" while the building sits on top. We need to either (a) teach `terrainMissingTexts` to ignore tiles covered by `proc-building`, or (b) auto-generate filled textures so the debug layer never sees them as missing.

## Questions for the Expert
1. What is the best strategy to suppress missing-text labels for tiles covered by a `proc-building` footprint?
   - Should we mark those tiles to skip `terrainMissingTexts`?
   - Or should we provide a procedural texture to the terrain loader so it believes the PNG exists?
2. If we skip the label, how do we handle cases where a building footprint partially extends outside the map or overlaps non-structure tiles?
3. Are there better ways to signal missing textures without spamming labels once a procedural building handles the visuals?
4. Would you recommend storing footprint metadata (list of covered tiles) to the prop so we can easily cross-reference in `terrainMissingTexts`?

## Relevant Source Files
1. `apps/web/src/modules/tactical-sandbox/components/BattlefieldStage.tsx`
   - Contains `terrainMissingTexts`, `tileGraphics`, `procBuildings`, `topGeomFor`, helpers.
2. `apps/web/src/modules/tactical-sandbox/sample-data.ts`
   - Uses `addProcBuildingRect` to stamp sample warehouses.
3. `packages/core/src/simulation/types.ts`
   - Defines `MapProp`, `PropKind`, and new fields for `proc-building`.
4. `apps/web/public/textures/terrain/*.png`
   - External texture override folder; `structure.png` currently missing.
5. `docs/prompts/multi_tile_structures_prompt.md` (this file) – overall specs.

## Desired Outcome
- Buildings render without duplicated "structure.png" text on each tile.
- Terrain overlay debug labels remain useful for **other** terrain types (e.g., missing `water.png`).
- Implementation stays data-driven: building footprints defined via `MapProp`, terrain overlay knows when to suppress placeholder.
