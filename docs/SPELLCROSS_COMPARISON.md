# Spellcross Remake vs. Original Design

This document tracks the current implementation against the design anchors in
`MANUAL.cz.md`, `DESCRIPTION.sk.md`, and `project_spec.md`.

Last reviewed: 2026-07-30.

## Measured Parity

Counts are read from `packages/data/src`; the original's figures come from the
75 `M*.DTA` mission files of the installed 1998 game.

| Metric | Remake | Original |
| --- | --- | --- |
| Campaign operations | 29 | 61 |
| Unit definitions | 80 (38 Alliance, 42 Other Side), all reachable | — |
| Research nodes | 51 | — |
| Objective family combinations | 8 across 29 operations | 6 families |
| Outcome-dependent branches | 2 | 25 |
| Battlefield cells | min 1,620, median 2,160, max 4,200 | min 1,620, median 4,200, max 12,600 |

Every operation now matches or exceeds the original's *smallest* battlefield.
The median does not: a typical original mission is still about twice the area of
a typical one here, and 5 of 29 reach the original's median. Operation count and
branch density are the two rows where the original remains clearly ahead.

## Current State

| Area | State |
| --- | --- |
| Strategic layer | Playable campaign loop with territories, timers, resources, research, recruitment, refills, formations, events, saves, and campaign outcome handling. |
| Tactical layer | Playable isometric battles with action points, fog of war, line of sight, morale, XP, cover, elevation, overwatch reaction fire, ammo, supply, healing, transports, mission events, objectives, victory, defeat, and retreat. |
| Units and factions | Alliance and Other Side rosters cover the main expected battlefield roles, including infantry, scouts, armor, artillery, air, support, commanders, undead, monsters, casters, flyers, siege units, and static defenses. |
| Opponent turn logic | Objective-aware movement, target scoring, difficulty modifiers, demolition targeting, supply and healing behavior, and fog-aware attack gating are implemented. |
| Audio and visual polish | Weapon, movement, impact, ambient, UI, limiter, camera, shake, hit-stop, hover preview, wrecks, smoke, fog memory, shadows, props, and unit sprites are implemented. |

## Strategic Layer

Implemented:

- Europe campaign map with 29 sectors across two acts, plus generated counteroffensive sectors.
- One battlefield operation per strategic turn, so the war clock, recruitment, and research pacing cannot be bypassed.
- Money, research, and strategic points.
- Strategic point conversion to money and research.
- Territory timers and global campaign pressure.
- Recruitment delay through `availableOnTurn`.
- Unit refills, rearming, dismissal, tiers, XP carry-over, and preserved benched units.
- Research queue with one active project at a time.
- Research unlocks and stat bonuses for existing and newly deployed units.
- Formation bonuses applied when building a battle side.
- Persistent officer corps with six recruitable profiles and four progression ranks, assignable to fielded units.
- Researched equipment doctrine with three slots — offense, protection, mobility — offering four trade-off choices each.
- Three save slots with serialized campaign/battle state and confirmed save deletion.
- Victory, defeat, retreat, rewards, unlocks, and terminal campaign outcome.

Partially implemented or simplified:

- Formations exist mechanically, but formation management UI is still lightweight.
- Resource economy is fixed per sector and event, not a full depletion model.

Missing or deferred:

- Resource allocation slider.
- Blind research.
- Full-motion story interludes or cutscenes.
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
- Objectives: eliminate, reach, protect, and hold, combined into eight distinct mission shapes.
- Required specialist interactions with their own completion deadlines, where losing the specialist is an authored failure.
- Scenario-authored reserve events triggered by battle round or enemy attrition.
- Difficulty-scaled reinforcement waves: none on Story, two units on Commander, three on Veteran,
  and four on Veteran in the hardest sectors.
- Dedicated rescue and convoy operations with key units that must reach extraction or delivery zones alive.
- Retreat rules that can destroy deployed units outside the start zone.

Partially implemented or simplified:

- Opportunity fire does not yet use a separate initiative contest.
- Attack categories are broad unit classes rather than a deep armor/light/heavy/object matrix.
- Radar deploy/pack behavior is not implemented.
- Tactical events currently spawn units and messages; object, dialogue, and cutscene actions remain future extensions.

## Units

Eighty definitions ship — 38 Alliance and 42 Other Side. Every one is reachable
from campaign content: the 42 hostiles are fielded by scenario forces or reserve
events, and the 38 Alliance units are obtainable from the starting force or a
research unlock. The lists below name the core roles rather than the full roster.

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

1. Extend tactical event actions with object state changes, map dialogue, and forced-retreat phases.
2. Give caster, monster, radar, and commander units more distinct active abilities.
3. Expand formation and officer management in the strategic UI.
4. Add more scenario-specific story flavor without copying original text.
5. Keep splitting the renderer into smaller modules as visual systems stabilize.

## Original Data Audit

The installed 1998 game data was reviewed alongside the manuals and gameplay footage. Its extracted
mission definitions contain 95 tactical mission files, 41 missions with special-event triggers, and
six objective families: destroy all units, destroy a named unit, destroy an object, discover a place,
transport a unit, and save a unit. The most memorable operations use several of these together, such
as locating stores, escorting a convoy, transporting specialists, and finding a landmark before
engaging a named commander.

The remake now covers these patterns through eliminate, reach, protect, and hold objectives, plus
rescue/convoy key units and scripted reserve waves. The original still has more authored mid-mission
dialogue, named bosses, object-specific objectives, and cinematics. Those are content-depth gaps, not
missing foundations in the combat engine.
