# Spellcross Remake – Architecture Blueprint

## Monorepo Layout

- `apps/web`: Player-facing web client (Vite + React + Pixi). Hosts tactical sandbox, future campaign UI, scenario editor.
- `packages/core`: Headless simulation engine. Deterministic logic for tactical combat, timeline events, AI hooks.
- `packages/data`: Content pipeline. Validates unit/terrain config with zod and exports data bundles for runtime.
- `packages/services`: (Future) backend services. Placeholder Fastify server for save-sync, leaderboards, PvP relay.
- `packages/config/*`: Shared tooling (eslint config today, more to come).

Tooling: pnpm workspaces + Turborepo orchestrate builds/tests. TypeScript `tsconfig.base.json` ensures consistent compiler settings.

## Core Engine Principles

1. **Deterministic Simulation** – All tactical decisions remain pure TypeScript functions. Side effects live in the host (web or services). This simplifies testing and supports eventual PvP replays.
2. **Data-Driven Content** – Units, weapons, terrain are JSON schemas validated in `@spellcross/data`. Designers iterate without rebuilding code.
3. **Hex Grid Tactical Layer** – `TacticalBattleState` represents canonical battlefield state. `TurnProcessor` manages initiative, action points, and logs battle events.
4. **Traversal & Pathfinding** – A* over axial hexes (`planPathForUnit`) respects terrain cost, morale penalties, and live occupancy, ensuring UI previews match real AP expenditure.
5. **Combat Resolution** – Direct-fire resolution (`resolveAttack`) handles range validation, armor/cover mitigation, morale damage, AP costs, and emits battle events consumed by the UI.
6. **Adaptive Vision & Fog of War** – `updateFactionVision` computes per-faction sight cones with hex LoS and terrain occlusion, persisting explored tiles for UI rendering and AI awareness.
7. **Timeline & Telemetry** – Every mutating action emits structured events. UI replays them, analytics store them, cloud sync can diff states vs. event streams.
8. **Extensible Systems** – Simulation structured around interchangeable systems (`turn-processor`, `combat-resolver`, `vision-system`, etc.) so we can add stealth, overwatch, morale without rewrites.

## Web Client Slice

- Vite provides dev server and build pipeline.
- React renders shell UI (`TacticalSandboxPage`), while Pixi handles battlefield rendering (`BattlefieldStage`).
- Hook `useBattleSimulation` bridges UI with simulation engine.
- Styling kept minimal CSS for now; will migrate to design tokens / theming later.

## Immediate Next Tasks

1. **Simulation Roadmap**
   - Extend combat with accuracy roll, suppression/stagger effects, overwatch, and armor penetration variance.
   - Evolve fog of war with stealth units, sensor sweeps, and shared allied vision rules.
   - Expand timeline event coverage (status effects, overwatch triggers, objective updates).
2. **Content Pipeline**
   - Port real unit/weapon data from original game into `packages/data`.
   - Create terrain presets (forest, urban, swamp) with balancing knobs.
   - Build data validation tests ensuring parity with original stats.
3. **Web UX**
   - Expand unit HUD to support multi-weapon selection and show predicted hit chance/damage.
   - Provide command palette (move, attack, overwatch) tied to core actions.
   - Enrich turn log entries with icons, filtering, and action grouping.
4. **Rendering Enhancements**
   - Replace placeholder hex with isometric tileset; add lighting layers.
   - Support zoom/pan, camera focus on events, and destructible props visuals.
5. **Tooling & QA**
   - Configure lint/test pipelines in CI (GitHub Actions).
   - Flesh out Vitest suites for simulation, plus Cypress smoke tests for UI.
   - Add storybook (or Ladle) for UI components.
6. **Narrative & Campaign**
   - Draft strategic layer state machine (world map, research, logistics).
   - Prototype mission briefing UI tied to data-driven scenario scripts.
   - Define save-game schema compatible with upcoming backend.

## Longer-Term Milestones

- **Strategic Layer**: Implement Earth map progression, resource economy, research tree, logistics.
- **AI Director**: Build strategic AI that plans invasions and reacts to player success.
- **Scenario Editor**: Web-based tool powered by `@spellcross/core` to create maps/missions.
- **Multiplayer Foundations**: Deterministic lockstep using event streams, optional authoritative service in `@spellcross/services`.
- **Live Operations**: PWA offline support, cloud saves, telemetry dashboards for balancing.
