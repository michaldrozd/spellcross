# Spellcross Remake vs. Original Design

This document tracks the current implementation against the design anchors in
`MANUAL.cz.md`, `DESCRIPTION.sk.md`, and `project_spec.md`.

Last reviewed: 2026-06-28.

## Current State

| Area | State |
| --- | --- |
| Strategic layer | Playable campaign loop with territories, timers, resources, research, recruitment, refills, formations, events, saves, and campaign outcome handling. |
| Tactical layer | Playable isometric battles with action points, fog of war, line of sight, morale, XP, cover, elevation, overwatch reaction fire, ammo, supply, healing, transports, objectives, victory, defeat, and retreat. |
| Units and factions | Alliance and Other Side rosters cover the main expected battlefield roles, including infantry, scouts, armor, artillery, air, support, commanders, undead, monsters, casters, flyers, siege units, and static defenses. |
| Opponent turn logic | Objective-aware movement, target scoring, difficulty modifiers, demolition targeting, supply and healing behavior, and fog-aware attack gating are implemented. |
| Audio and visual polish | Weapon, movement, impact, ambient, UI, limiter, camera, shake, hit-stop, hover preview, wrecks, smoke, fog memory, shadows, props, and unit sprites are implemented. |

## Strategic Layer

Implemented:

- Europe campaign map with 17 main sectors and generated counteroffensive sectors.
- Money, research, and strategic points.
- Strategic point conversion to money and research.
- Territory timers and global campaign pressure.
- Recruitment delay through `availableOnTurn`.
- Unit refills, rearming, dismissal, tiers, XP carry-over, and preserved benched units.
- Research queue with one active project at a time.
- Research unlocks and stat bonuses for existing and newly deployed units.
- Formation bonuses applied when building a battle side.
- Save slots and serialized campaign/battle state.
- Victory, defeat, retreat, rewards, unlocks, and terminal campaign outcome.

Partially implemented or simplified:

- Formations exist mechanically, but formation management UI is still lightweight.
- Commanders exist as hero units and aura effects, but there is no full officer attachment system.
- Resource economy is fixed per sector and event, not a full depletion model.
- Unit upgrades are represented through research and tier/refill behavior, not a detailed equipment workshop.

Missing or deferred:

- Resource allocation slider.
- Blind research.
- Full officer attachment system.
- Scripted story interludes or cutscenes.
- Limited save/ironman rules.

## Tactical Layer

Implemented:

- Isometric square battlefield projection with camera, zoom, selection, movement planning, and click hitboxes.
- Terrain costs, passability, cover, elevation, fog of war, persistent explored tiles, line of sight, weather, stealth, and destructible tiles.
- Action points, attack costs, ammo, weapon ranges, weapon target restrictions, hit chance, damage, morale damage, XP, levels, suppression, routing, and destruction.
- Damage output scales down for wounded attackers.
- Overwatch and automatic reaction fire during movement.
- Threat previews for risky movement.
- Hover and target preview with hit chance, expected damage, and lethal indication.
- Supply trucks, field medics, transports, embark/disembark, supply zones, and pickups.
- Objectives: eliminate, reach, protect, and hold.
- Retreat rules that can destroy deployed units outside the start zone.

Partially implemented or simplified:

- Opportunity fire does not yet use a separate initiative contest.
- Attack categories are broad unit classes rather than a deep armor/light/heavy/object matrix.
- Radar deploy/pack behavior is not implemented.
- Reinforcements and ambush triggers are not a general scenario scripting system yet.

## Units

Alliance roles represented:

- Commander: Captain John Alexander.
- Infantry: Light Infantry, Storm Squad, Ranger Recon, Pathfinder Snipers.
- Support infantry: Field Medic.
- Vehicles: M113 IFV, Leopard 2 MBT, Gepard AA, Sky Lance SAM.
- Artillery: Mortar Team, M109 SPG, Paladin ACS.
- Air: Attack Helicopter.
- Logistics: Supply Truck.

Other Side roles represented:

- Line and scout infantry: Orc Warband, Ghoul Pack, Skeleton Horde, Hell Rider, Specter.
- Heavy monsters and siege units: Ogre Brute, Salamander, Demon Engine.
- Casters and commanders: Necromancer, Warlock, Lich Lord.
- Flyers: Winged Fiend, Void Drake.
- Static defense: Arrow Tower.

Still open:

- More unique abilities for caster and monster units.
- Fortress-style boss encounter content.
- More specialized reconnaissance and radar-style support units.

## User Experience

Implemented:

- Main menu with save slots.
- Strategic HQ with map, territory briefings, army management, research, resources, and campaign notices.
- Deployment flow before battle.
- Tactical HUD with unit panel, objectives, combat log, attack controls, supply, healing, overwatch, retreat, end turn, and auto turn.
- Tooltips and onboarding copy for key workflows.
- End-state screens for campaign victory and defeat.

Still open:

- Denser formation management UI.
- More detailed unit inspection popup.
- Optional faster animation mode for repeated late-campaign turns.
- More tutorial coverage for advanced mechanics.

## Best Next Improvements

1. Add deeper tactical scripting: ambushes, reinforcements, forced retreats, and special objectives.
2. Give caster, monster, radar, and commander units more distinct active abilities.
3. Expand formation and officer management in the strategic UI.
4. Add more scenario-specific story flavor without copying original text.
5. Keep splitting the renderer into smaller modules as visual systems stabilize.
