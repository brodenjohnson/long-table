# Long Table (codename)

A dark, adult farming and settlement game with combat, set in the world of Wasteland Settlement. Browser first, Steam later.

You wake in a hardened valley farm with no memory and a note in your own handwriting. Grow food in bad ground, sell it to the Hull truck, take on hired hands, and keep the farm standing against the Husks that walk at night and the Crew that work the road.

## Play it

```
cd game
npm install
npm run dev          # http://localhost:5173
```

Or play the build on GitHub Pages, if it is turned on for the repo. `.github/workflows/playtest.yml` builds and publishes it, and explains the one-time setup.

Saves live in the browser, so a save made on localhost will not show up on the Pages link, and the reverse.

Controls: WASD to move, left mouse to use what is in your hand, right mouse or E to interact and harvest, 1 to 0 or the wheel to pick an item, Space to roll, F for the lantern, Tab for the bag, C to make things, M for the map, J for the journal, Esc for the menu. A controller works too (see Controls in the menu).

## Build and test

```
cd game
npm run build        # typecheck and build to game/dist
npm test             # Playwright regression tests (uses your installed Chrome)
npm run ipcheck      # fails if a name from another game appears anywhere
```

## Desktop (Steam) build

```
cd desktop
npm install          # downloads Electron, about 100 MB
npm start            # builds the web game and opens it in a desktop window
npm run dist         # Windows, Mac and Linux builds into desktop/release
```

Saves in the desktop build are JSON files in the app data folder (`saves/slot0.json` and so on), ready for Steam Cloud. Steamworks itself waits for an app id.

## Where things are

- `docs/PLAN.md`: the plan, the decisions log, the names and trademarks rules
- `CLAUDE.md`: the project guide for people and for Claude
- `docs/lore/`: the story and earlier design from Wasteland Settlement
- `game/src/`: the game (TypeScript, PixiJS 8). `sim/` is the simulation, `render/` draws it, `art/` paints every sprite in code, `ui/` is the DOM layer, `audio/` synthesises all sound, `data/` holds the content as JSON
- `game/artview.html`: a page that shows the generated art at 3x (`?show=chars` or `?show=props`)
- `desktop/`: the Electron wrapper
- `tools/ip-check.mjs`: the banned-names check
