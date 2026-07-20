# Spellcross Remake Architecture

## Runtime layout

- `apps/web` is the player-facing Vite application. React owns menus and HUD state; Pixi renders the tactical battlefield.
- `packages/core` owns campaign state, tactical simulation, pathfinding, combat, vision, morale, objectives, opponent turns, and persistence encoding.
- `packages/data` owns validated units, research, campaign territories, scenarios, maps, objectives, props, and canonical balance values.
- `packages/services` is an optional Fastify service shell. The shipped game currently stores campaigns locally and does not require a backend.
- `packages/config` contains shared workspace tooling.

The production web build is static and emitted to `apps/web/dist`.

## Campaign flow

The campaign state contains the army and reserves, formations, resources, research, territory progression, reports, campaign outcome, and an optional active tactical battle. A campaign permits one battlefield operation per strategic turn. Ending the strategic turn advances research, recruits, territory timers, scripted events, raids, upkeep, and the global war clock.

Campaigns are stored in three browser `localStorage` slots. Tactical state uses a tagged JSON representation so `Map`, `Set`, and infinite-ammunition values survive reloads. Older saves without newer optional fields are hydrated with compatible defaults.

## Tactical simulation

`TacticalBattleState` is the canonical battle model. Core systems handle:

- movement and terrain-aware pathfinding;
- line of sight, weather, stealth, and persistent explored fog;
- action points, weapon ranges, target restrictions, hit chance, armor, cover, elevation, morale, XP, and destruction;
- overwatch, transports, supply, healing, destructible terrain, and scenario objectives;
- player Auto Turn and objective-aware opponent turns.

The renderer consumes that state and adds camera control, selection and hit areas, movement interpolation, directional sprites, terrain textures, props, shadows, particles, combat effects, audio cues, the minimap, and HUD feedback. The Pixi renderer is route-split so strategic play does not download it until a battle starts.

## Content boundary

Canonical gameplay content belongs in `packages/data`; UI translations belong in `apps/web/src/i18n/locales`. Rendering code must not duplicate unit or campaign balance values. New scenarios should define their map, forces, deployment zones, props, weather, and objectives in the data bundle and be covered by the all-territory launch regression.

## Release checks

Run these from the repository root before integration:

```bash
pnpm lint
pnpm test
pnpm build
pnpm exec playwright test
```

Visual changes must also follow `docs/visual-qa-protocol.md`, including worst-frame checks for movement and ground contact.
