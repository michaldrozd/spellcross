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


<claude-mem-context>
# Memory Context

# [spellcross] recent context, 2026-05-06 8:55am GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 26 obs (10,994t read) | 898,966t work | 99% savings

### Apr 24, 2026
1119 8:26p 🔵 spellcross — full project architecture confirmed
1121 8:28p 🔴 @spellcross/data test suite fails — arrow-tower unit has mobility: 0, violating Zod schema
1122 " 🔵 spellcross — unit roster, research tree, campaign territories, and app architecture deep-dive
1129 8:47p ⚖️ spellcross — AI sprite generation prompt strategy
1134 9:16p 🔵 spellcross /new directory — 4 candidate sprite PNGs
1139 9:44p ⚖️ spellcross — sprite generation via ChatGPT.com playwright-headful MCP strategy
1140 9:46p 🔵 spellcross — ChatGPT.com playwright session confirmed logged-in as Michal Drozd (Pro)
1141 " 🔵 spellcross — ChatGPT.com composer menu confirms "Create image" mode available via playwright
1154 10:05p 🔵 spellcross — ChatGPT browser session active for Heavy Infantry sprite generation
1155 " 🔵 spellcross — ChatGPT generated Heavy Infantry sprite sheets confirmed, 3 completed images found
### Apr 25, 2026
1242 9:24a 🔵 spellcross — full scope of recent uncommitted changes confirmed
1243 " 🔵 spellcross — directional 8-way unit sprite system added for infantry types
1244 " 🔵 spellcross — MapProp schema added and all four battle maps populated with props
1245 " 🔵 spellcross — unit faction markers and status bars fully redesigned
1246 " 🔵 spellcross — strategic map hover hit zone enlarged via invisible circle overlay
1247 " 🔵 spellcross — __campaignControl dev window object and E2E test infrastructure overhauled
1249 10:13a 🔵 spellcross — M113/tank shadow rework: ellipse vs ISO polygon visual review
1251 " 🔵 spellcross — BattlefieldStage shadow implementation: per-unit-type ellipse dimensions confirmed
1304 3:16p ⚖️ spellcross — visual QA audit initiated against old reference screenshots
1306 4:49p 🔵 spellcross remake — brutal visual audit initiated with 9 reference images
1307 5:04p 🔵 spellcross — brutal visual QA re-audit with numeric score requested
1308 8:02p 🔵 spellcross — visual QA audit v8 pass: muted backdrop + green HUD + sprite scale fix
1310 8:08p 🔵 spellcross — visual QA re-audit after terrain decals and HUD command-rack changes
1312 " 🔵 spellcross — all four reference images successfully loaded for visual QA re-audit
### Apr 26, 2026
1378 7:49p 🔵 spellcross — visual QA re-audit after terrain and overlay refinements
1380 7:58p 🔵 spellcross — visual QA re-audit after HUD/range pass

Access 899k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>