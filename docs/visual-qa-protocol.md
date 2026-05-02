# Visual QA Protocol

Use this checklist before accepting visual fixes, especially tactical rendering, unit animation, hit areas, selection markers, terrain overlays, and UI layout.

## Evidence

For every visual bug, capture the issue locally instead of relying on a player-provided screenshot as the primary proof.

Required evidence:

- Full-screen context screenshot.
- Close crop of the exact object or UI area at player-visible zoom.
- Worst-case crop selected from the ugliest visible frame or state, not the average frame.
- Before/after comparison sheet when a previous failing image exists.
- Direction/state sheet when the object has orientations or animation frames.

For motion bugs, capture start, mid-motion, end, and a contact sheet or short video. Include the exact scenario, camera/zoom, unit, direction, frame timing, commit, and URL/cache token in the evidence manifest.

## Pass Criteria

A visual pass is valid only when the worst-case frame passes. Do not accept a broad or averaged pass if the worst visible frame still looks wrong.

Before committing a visual fix:

- Verify the exact reported scenario.
- Verify at least one nearby scenario that used to work.
- Run focused unit tests.
- Run focused Playwright regressions for movement, click selection, and camera behavior when relevant.
- Re-check the new worst-case evidence after the fix.

## Vehicle Contact

For vehicle ground-contact issues, always include:

- User-scale close crop.
- E/W side-view crop.
- N/S view crop.
- Best diagonal comparison.
- Before/after sheet when a previous failing crop exists.

If small code offsets stop improving the result, switch to asset baseline/crop cleanup instead of stacking more offsets.
