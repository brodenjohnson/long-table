# Project guide for Claude

Codename **Long Table**. A dark, adult farming and settlement game with combat, built for the browser first and for Steam (through Electron) later. It continues the world and story of Wasteland Settlement (github.com/brodenjohnson/wasteland-settlement, frozen at 0.12.0) with new code, and reuses the technology from the Hammerfell project (github.com/brodenjohnson/Elder-Scrolls---Hammerfell). Hobby project by Broden Johnson (Gold Coast, Australia), built with Claude in VS Code, aimed at a commercial release.

## Start here
1. Read `docs/PLAN.md`, including the decisions log in section 11. It is the source of truth until a design bible replaces it.
2. Read `docs/lore/STORY.md` and `docs/lore/STORY_BIBLE.md` for the story, and `docs/lore/WORLD_DESIGN.md` and `docs/lore/CRAFTING_PLAN.md` for earlier system design. These came from Wasteland Settlement and still use some names that must change (PLAN section 3).
3. Build and run the tests before changing anything: `cd game && npm install && npm run build && npm test && npm run ipcheck`.

## How we work
- Australian English. Plain, a little dry. No emojis. No em dashes. Never use the words "genuinely" or "honestly".
- Challenge scope creep and overextension. If a request would spread the project too thin, say so and propose an order.
- Broden decides direction. Claude may reorder the roadmap and overrule suggestions where it has a good reason, and says why. Broden prefers that Claude decides and builds, then explains plainly what it did and did not do.
- Build in small, tested increments. After each feature, run the regression tests, then release a playtest build. Say plainly what you did not do.
- Keep `docs/PLAN.md` (later the design bible) and this file current. Log decisions with dates.

## Names, trademarks and other people's work
- Every name, picture, sound and UI layout is our own. Nothing is named after, styled on or traced from another game. When in doubt, rename.
- Nothing from The Elder Scrolls, Fallout or any other game's lore, data or art. Code ported from the Hammerfell project is checked for Elder Scrolls names and Skyrim data as it comes across.
- The banned-strings check (`tools/ip-check`, to be built in Phase 0) runs with the tests and must pass before any release.
- Fonts, sounds and bought art go in `docs/CREDITS.md` with their licence. Commercial-use licences only.
- Anything AI-generated (art, audio, voices) is listed in `docs/CREDITS.md` for Steam's disclosure.

## Technical rules
- TypeScript, PixiJS 8, Vite, Playwright, Electron for desktop. Pin exact dependency versions.
- The simulation runs on a fixed tick with no rendering code in it. The renderer only reads simulation state.
- Everything content-like is data (JSON, validated on load). Code reads data.
- Expose `window.__game` so Playwright can drive and inspect the game. A test for every feature. Keep a regression list and run it before every release.
- Saves use a versioned schema with explicit migrations. Never break an old save of this game without saying so first. Never rename an item or change saved data without a migration.
- Keep the art pipeline apart from game code. The game reads only PNG sheets and JSON atlases.
- Controller support and 1280 by 800 readability are requirements from the first build, not polish.
- Release flow: `VERSION`, `CHANGELOG.md`, a release script, playtest hosting, an in-game notice when a newer build is out.

## Layout
- `game/src/core/`: config (tile size, map size, time), isometric maths, seeded random and noise.
- `game/src/data/`: content as JSON (crops, items, objects, recipes, enemies, people, documents) and `index.ts`, the only place code reads it, with `validateData()`.
- `game/src/sim/`: the simulation. `world.ts` (terrain, soil, objects, crops), `worldgen.ts` (the valley and `PLACES`), `state.ts` (everything saved), `sim.ts` (the step, the player, farming, interacting), `night.ts` (Husks and the night resolved while you sleep), `raiders.ts` (the Sallow Crew), `hands.ts` (hired hands, including guards), `trader.ts` (the Hull truck and depot), `day.ts` (end of day and the morning report), `save.ts` (versioned saves, migrations, browser and desktop stores), `path.ts` (A*).
- `game/src/render/`: Pixi rendering. `renderer.ts` (sprites, depth sorting, light map, weather), `ground.ts` (chunked ground), `fx.ts` (particles and decals).
- `game/src/art/`: every sprite drawn in code. `pixel.ts` (crisp edges and outlines), `iso3.ts` (box painter), `ground.ts`, `props.ts`, `crops.ts`, `rig.ts` (the 3D character rig, 8 directions), `vehicles.ts`, `icons.ts`, `atlas.ts` (packing).
- `game/src/ui/`: DOM UI (`ui.ts`, `ui.css`). `game/src/audio/audio.ts`: synthesised sound and music. `game/src/input/input.ts`: keyboard, mouse, controller.
- `game/src/game.ts`: the controller that wires it together and exposes `window.__game` for tests.
- `game/tests/game.spec.ts`: the regression tests. `desktop/`: the Electron wrapper. `tools/ip-check.mjs`: the banned-names check.

## Rules that matter in this code
1. The sim never draws and never touches the DOM. It emits `SimEvent`s; `game.ts` routes them to the renderer, UI and audio.
2. Pixi keeps a sprite's anchor when its texture changes. Use `setTex()` in `renderer.ts` when swapping textures of different sizes.
3. Anything that happens overnight and belongs in the morning report goes in `sim.notes`, not `state.report` (which `endDay` replaces).
4. New saved state needs a migration in `save.ts` and a bump of `SAVE_VERSION`. There is a test that loads a version 1 save.
5. `endDay` resolves the rest of the night (raiders, then Husks) before anything else, so sleeping early is never a way out.
6. Art is painted at startup into atlas pages. A new look for a character must be painted with `paintCharacterSet` before it is drawn (hands are painted on demand).

## Status
- 2026-11-13: plan written (`docs/PLAN.md`).
- 2026-11-13: 0.1.0 playtest build. Phase 0 and most of Phase 1 and 2 done in one long session (see `CHANGELOG.md` and PLAN section 11). 14 regression tests pass. Next: Broden plays it; then the Hull as a place, livestock, Chapter One on the new map, and Steamworks once there is an app id.
