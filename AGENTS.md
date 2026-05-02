# Spellcross Remake Working Notes

These are long-lived project instructions for contributors working in this repository.

## Goal

- Finish the Spellcross-inspired game so it plays close to the original described in `MANUAL.cz.md` and `DESCRIPTION.sk.md`: strategic world map, turn-based tactical battles, units, economy, research, and story flavor.
- Use the manuals and available reference screenshots as design anchors, but keep all copy and implementation original.

## Stack And Layout

- Monorepo managed by `pnpm` and `turbo`.
- App: `apps/web` using Vite, React, and Pixi.
- Shared libraries: `packages/core`, `packages/data`, `packages/services`, `packages/config`.
- Use TypeScript throughout and keep types strict.

## Development Rules

- Prefer incremental, well-scoped changes.
- Keep existing workspace scripts working:
  - `pnpm lint`
  - `pnpm test`
  - `pnpm build`
  - `pnpm exec playwright test`
  - app-level scripts in `apps/web`: `dev`, `build`, `lint`, `test`, `e2e`
- Respect workspace tooling and formatting.
- Write or maintain unit tests and Playwright tests for critical gameplay, rendering, and UI flows.
- Do not commit secrets, credentials, generated browser state, local logs, or machine-specific config.

## Game Requirements

- Strategic layer: territories with timers, resources, unit management, research tree, commanders, formation bonuses, and campaign progression.
- Tactical layer: isometric grid battles, action points, opportunity fire, morale, XP, objectives, victory, and retreat rules.
- Content: unit types, enemy factions, UI text, and help should stay consistent with the manuals while being rewritten in original wording.
- UX: clear tutorials, tooltips, keyboard and mouse controls, responsive layout, and a Spellcross-like tone.
- Data: centralize canonical game data in `packages/data`; avoid duplication.
- Quality: handle errors gracefully and keep logs clean.

## Assets And References

- Use `MANUAL.cz.md` and `DESCRIPTION.sk.md` as canonical design references.
- Existing assets in `pics/` may be reused where appropriate.
- External visual references may be used for understanding the original game style, but new assets should be original or clearly safe to use.

## Visual QA

Follow [docs/visual-qa-protocol.md](docs/visual-qa-protocol.md) before accepting visual fixes.

Important points:

- Reproduce visual issues locally and capture evidence yourself.
- Capture full-screen context, close crops, worst-case crops, and before/after comparison sheets.
- For motion bugs, capture start, mid-motion, end, and a contact sheet or short video.
- A visual pass is valid only when the worst visible frame passes.
- For vehicle ground contact, always check E/W side view, N/S view, a best diagonal comparison, and a before/after sheet.

## Verification

Before finishing a gameplay or rendering change:

- Run the narrowest relevant unit tests.
- Run focused Playwright regressions for movement, click selection, camera behavior, and UI state when relevant.
- Capture screenshots of the exact scenario being changed.
- Check nearby scenarios that previously worked, so fixes do not reintroduce old visual or gameplay bugs.

## Local System Access

- Prefer normal user-level commands.
- Use elevated privileges only when required for local tooling or services, and keep such changes out of the repository.
