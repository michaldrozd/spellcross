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

## Local hardware GPU runs

Normal Playwright commands remain headless and portable. For sustained local visual or 3D validation on Linux, use the opt-in hardware runner instead. It serializes the suite, acquires the shared GPU lease, rejects an occupied GPU or another heavy renderer, verifies an NVIDIA WebGL renderer, and records CPU/GPU temperatures plus thermal-throttle counters.

Provide a new empty evidence directory and a new empty browser-state directory for every run. The browser-state path must stay under 61 characters so Chrome can create its IPC sockets:

```sh
DISPLAY=:1 \
PLAYWRIGHT_GPU_UUID=<gpu-uuid> \
PLAYWRIGHT_NVIDIA_PROVIDER=<xrandr-provider> \
PLAYWRIGHT_RESOURCE_CTL=<agentctl-path> \
PLAYWRIGHT_HARDWARE_STATE_DIR=<short-persistent-browser-state-directory> \
PLAYWRIGHT_HARDWARE_EVIDENCE_DIR=<persistent-evidence-directory> \
pnpm e2e:hardware
```

The runner stops without launching Chrome if the lease, display provider, selected GPU, host load, or process preflight is not clean. It renews the lease during longer runs and handles terminal hangups as failures. It also fails the run if the renderer is not NVIDIA, SwiftShader appears, a foreign heavy renderer starts, a load or thermal limit is exceeded, or any CPU thermal-throttle counter grows or changes availability. The renderer string comes from a sibling Chrome launch with the same options; continuous process monitoring binds every suite browser to the requested GPU. The runner environment flag is an accidental-use guard rather than a security boundary. The runner never changes CPU governors, power limits, or system-wide performance settings.

## Vehicle Contact

For vehicle ground-contact issues, always include:

- User-scale close crop.
- E/W side-view crop.
- N/S view crop.
- Best diagonal comparison.
- Before/after sheet when a previous failing crop exists.

If small code offsets stop improving the result, switch to asset baseline/crop cleanup instead of stacking more offsets.
