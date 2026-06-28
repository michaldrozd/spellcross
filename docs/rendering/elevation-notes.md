# Elevation Rendering Notes

The current game keeps elevation as a lightweight visual and movement-cost
feature. The renderer supports richer corner data, but the movement executor and
pathfinder intentionally share the same simple passability rules.

## Current Model

- `MapTile.elevation` is the baseline height value.
- `MapTile.cornerHeights` may override per-corner visual heights.
- `MapTile.elevEdges` may mark slope-style edges for renderer shaping when data
  provides it.
- The isometric pathfinder does not enforce cliff barriers by elevation alone.
  This matches `TurnProcessor.moveUnit`; both systems must stay aligned.

## Renderer Rules

- `BattlefieldStage` derives tile corner heights from `cornerHeights`,
  `elevation`, and optional `elevEdges`.
- Shared vertices are snapped by taking the maximum contributing height.
- Vertical faces are drawn from the snapped corner delta.
- Slope-marked edges skip the vertical wall for that edge.
- Terrain overlays should stay top-facing and must not introduce visible seams.

## Movement Rules

- Passability comes from the tile and unit type.
- Movement cost comes from terrain cost and stance/weather multipliers.
- If stricter cliff or ramp movement returns later, update these together:
  `TurnProcessor.moveUnit`, `planPathForUnitIso`, tests, and visual QA cases.

## Source Anchors

- `packages/core/src/simulation/types.ts`: elevation fields.
- `packages/core/src/simulation/pathfinding/iso-pathfinder.ts`: planner rules.
- `packages/core/src/simulation/systems/turn-processor.ts`: executor rules.
- `apps/web/src/components/BattlefieldStage.tsx`: visual corner and wall pass.
