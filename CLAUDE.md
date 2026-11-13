# Project guide for Claude

Codename **Long Table**. A dark, adult farming and settlement game with combat, built for the browser first and for Steam (through Electron) later. It continues the world and story of Wasteland Settlement (github.com/brodenjohnson/wasteland-settlement, frozen at 0.12.0) with new code, and reuses the technology from the Hammerfell project (github.com/brodenjohnson/Elder-Scrolls---Hammerfell). Hobby project by Broden Johnson (Gold Coast, Australia), built with Claude in VS Code, aimed at a commercial release.

## Start here
1. Read `docs/PLAN.md`. It is the source of truth until a design bible replaces it. Section 10 lists open questions.
2. Read `docs/lore/STORY.md` and `docs/lore/STORY_BIBLE.md` for the story, and `docs/lore/WORLD_DESIGN.md` and `docs/lore/CRAFTING_PLAN.md` for earlier system design. These came from Wasteland Settlement and still use some names that must change (PLAN section 3).
3. Do not start Phase 0 until Broden has answered PLAN section 10.

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

## Status
- 2026-11-13: plan written (`docs/PLAN.md`). No code yet. Waiting on Broden's answers to PLAN section 10, then Phase 0.
