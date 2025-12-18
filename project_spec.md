# Project spec — Spellcross Remake

## Vision
Deliver a playable Spellcross-inspired remake that mirrors the gameplay described in `MANUAL.cz.md` and `DESCRIPTION.sk.md`: a strategic world map (resources, research, territory timers) tightly coupled with turn-based tactical battles on isometric maps, modern UI, and complete content (units, enemies, missions) that matches the manual in spirit but uses original wording and assets available in this repo.

## Must-have gameplay
- **Strategic layer**
  - Territories with timers, mission briefs, win/lose propagation; end-of-turn flow.
  - Resources: money, research points, strategic points with conversions; territory income.
  - Army management: recruit/refill (rookie/veteran/elite), upgrade, rearm (class change with XP impact), dismiss; commander/formation bonuses.
  - Research tree unlocking unit tech and upgrades; persistent army across missions.
  - Save/load campaign state (at least local storage or file; clean API for later backend).
- **Tactical layer**
  - Grid-based combat with AP, move/fire costs, LoS, opportunity fire, morale, XP/level-ups.
  - Mission objectives, victory/retreat rules (retreat loses units off start tiles), key units cause loss.
  - Unit stats/abilities reflect the manual; enemy factions with behaviors; fog-of-war or visibility rules.
  - Minimal but working AI turn flow (path/target selection, shooting, retreat when needed).

## Content & data
- Centralize canonical data in `packages/data` (units, factions, maps, research tree, economy constants, formation bonuses).
- Provide starter campaign: a handful of strategic territories with at least 2–3 tactical scenarios that demonstrate mechanics.
- UI texts, tips, tooltips follow the manual guidance but are rewritten in your own words.

## UX / UI
- Vite + React + Pixi front-end in `apps/web`:
  - Strategic map screen, army management, research, mission brief/debrief.
  - Tactical battle view with clear AP indicators, firing arcs/opportunity fire hints, morale/XP feedback.
  - Responsive layout; keyboard/mouse controls; accessible color/contrast.
  - Basic tutorial/onboarding overlay for new players.

## Engineering quality
- Tests:
  - Unit/integration with Vitest for data/model logic (AP, morale, XP, damage resolution, economy, research unlocks).
  - Playwright E2E for key flows: start campaign, take mission, battle loop (player & AI turns), win/retreat, strategic progression.
- Tooling: `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm exec playwright test` must pass.
- Keep TypeScript strict; no unused dead code; prefer pure/domain logic in `packages/core`.
- No secrets in repo; config via env only (but gameplay code should not depend on external secrets).

## Definition of Done
- Strategic and tactical layers playable end-to-end for the starter campaign (win/lose, retreat behaviors).
- Economy/research/army management implemented per design above.
- AI turn runs without crashes and provides a reasonable challenge.
- Tests pass: `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm exec playwright test`.
- UX polished enough to explain controls and rules; text matches the Spellcross theme (rewritten, not copied verbatim).

## Constraints & references
- Use `MANUAL.cz.md` and `DESCRIPTION.sk.md` as reference documents for mechanics and content; keep wording original.
- Preserve monorepo tooling: pnpm + turbo workspaces; Vite/React/Pixi in `apps/web`.
- Avoid breaking existing scripts or workspace setup.

