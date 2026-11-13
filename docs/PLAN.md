# Plan: from Wasteland Settlement to a Steam game

Status: proposal, 2026-11-13. Nothing is built yet. Section 10 lists what Broden needs to answer before Phase 0 starts.

Codename: **Long Table** (after the plan in the story). It is a codename, not the title. See section 3.

## 1. The game

A dark, adult farming and settlement game. You wake in a hardened valley farm after the war with no memory and a note in your own handwriting. On the coast, 3,012 people sleep in a failing vault, and you are the only one who can wake them. The valley has to grow big enough to take them in: food, water, beds, defence. How much you build decides how the story ends.

You start alone with a hoe and a pistol. You end up running a farm with hired hands, a depot that trader convoys call at, and roads you keep open by force. Later layers (owned trucks and routes, then towns you zone and run) grow out of the same farm rather than sitting beside it.

Combat is there because the economy creates it. Success draws attention, threats go after what you have built, the materials for the next tier sit in dangerous places, and once goods move, the roads need protecting. Fighting is one answer. Walls, guards, tribute, bargains and recruitment are others, and each costs something.

The adult tone comes from decisions more than gore: what you pay desperate people, who eats in a bad season, raiders who are people with their own economy, and a story about someone who could not stop counting who would die.

## 2. What we take from each project

### From Wasteland Settlement (content and design)
| Take | Notes |
|---|---|
| The story: the Meridian Trust, the Cradle, Unit 11, Odile, the Listeners, the Husks, Chapters One to Three, the Long Table and capacity endings | Copied to `docs/lore/`. Source of truth for story, subject to the renames in section 3. |
| Item, crop, recipe, enemy, weapon and armour tables | Converted to JSON data, renamed where section 3 says so, rebalanced. |
| The dialogue script format and the quest definitions | Ported to the TypeScript dialogue and quest systems from Hammerfell. |
| The balance model (`tools/balance.py`) and its findings | The tier 3 armour problem (78% reduction makes fights trivial) gets fixed in the rebuild, not carried over. |
| The 18+ gate with the gore setting, settler death as a setting | Kept. |
| Settlement levels, crafting tiers, the world atlas plan | Kept as design, revised for the new layout. |
| The player wiki generated from game data | Kept as an idea. Rebuilt later. |
| The habits: a test for every feature, a regression list, save compatibility, a changelog | Kept. |

Not taken: the code. One shared scope plus pass scripts that patch the assembled source by string replacement got the game to 0.12, but it will not carry a paid game through years of updates.

### From the Hammerfell project (technology and craft)
| Take | Notes |
|---|---|
| TypeScript systems: dialogue, quests, cutscenes, reputation, clock | `game/src/systems/`. Ported and generalised. |
| Versioned saves with migrations | `game/src/save/save.ts` (save version 6). Extended to write files on desktop. |
| The engine spike and its numbers | PixiJS 8 had the steadiest frames and a tenth of Phaser's memory. Chunked ground streaming, the depth sorting notes and the stutter fixes all apply here. |
| The art approach | Isometric ground, buildings and props drawn from code; the layered 8-direction character rig; palette ramps; the light map and torches. |
| Combat feel | Move while swinging, block, bash, dodge, finishers, impact sounds by weapon and armour. |
| Audio engine and the voice pipeline | `audio.js`, `voice.js`, `scripts/voices.mjs`. Steam requires AI-generated voices to be disclosed. |
| Tooling | Vite, TypeScript, `@playwright/test`, the release script, the GitHub Actions deploy, the new-version notice, the `window.__game` test hook. |

Not taken: anything that belongs to The Elder Scrolls. No names, places, races, creatures, lore, Skyrim data or numbers (`data/skyrim/` stays behind), no perk trees or levelling copied from Skyrim, and no UI modelled on Skyrim's. Code is checked for these strings as it is ported.

## 3. Names and trademarks

**Rule:** every name, picture, sound and UI layout in this game is our own. Nothing is named after, styled on or traced from another game. When in doubt, rename. This is a working checklist, not legal advice; a trademark search on the title is a separate job before the store page goes up.

### Must change before sale
| Now | Why | Proposed |
|---|---|---|
| Title "Wasteland Settlement" | Wasteland is a game series (inXile, now Microsoft) | A new title. Ideas in section 10. |
| Caps (bottle-cap money) | Fallout's money | **Scrip**: the Meridian Trust's ration scrip, still honoured in the valley. Ties to the lore. |
| Rad-Away | Fallout's item name | **Prussian Blue** (the real treatment for caesium poisoning) |
| Rad tabs | Echoes Fallout's Rad-X | **Iodide tabs** (the real preventive, potassium iodide) |
| Pipe Pistol | Fallout 4's weapon name | Fold into the existing Zip Gun, or a new name |
| Twohead cows and calves | Fallout's two-headed cattle are its best-known animal | One-headed **scald cattle**, hides marked by fallout. New look. |
| Bloater (creature) | The Last of Us enemy name | A new name and a new design |
| Spitter (creature) | Left 4 Dead enemy name | A new name and a new design |

### Should change (look derivative)
| Now | Why | Proposed |
|---|---|---|
| Hollowclaw | Same pattern as Fallout's Deathclaw | Rename, keep the creature |
| Roach hens, roach eggs | Echo Fallout's radroaches | Rename (grub hens), or redesign as poultry |
| Combat armour set | Strongly associated with Fallout | A plainer name (army surplus, service armour) |
| Glowing food (glowfish, glowmelon) | Common across the genre, close to Fallout | Keep for now, review with the art |

### Fine
Generic words and real-world things: raider, husk, scrap, hazmat suit, gas mask, Geiger band, zip gun, shotgun, medkit, the Wastes, the Hull, the Cradle, the Meridian Trust. A cryo vault of sleepers is a long-standing science fiction idea, and ours is not called a vault.

### Process
- A list of banned strings (`tools/ip-check`) runs in the test suite and fails the build if any of them appear in data, code or UI text: Fallout, Vault-Tec, Pip-Boy, Nuka, Caps as money, RadAway, Rad-X, Brahmin, Deathclaw, Elder Scrolls, Tamriel, Hammerfell, Redguard, Skyrim, and the rest of the list above.
- Fonts, sounds and any bought art are recorded in `docs/CREDITS.md` with their licence. Only licences that allow commercial use.
- Old Wasteland Settlement saves do not need to load in the new game. It is a new game, so the renames carry no migration cost.

## 4. Engine and technology

**Decision: TypeScript, PixiJS 8 for rendering, Vite to build, Playwright to test, Electron to ship on Steam.**

Why:
- Your own Hammerfell spike measured it: PixiJS kept the slowest 1% of frames near 1 ms at every crowd size and used 10 to 16 MB of memory, against Phaser's 115 to 130 MB. Canvas 2D fell to 58 fps with 300 characters on a slow CPU. This game will have crops, settlers, animals, raiders and later vehicles on screen at once, so it needs WebGL.
- Playtests stay in the browser. Friends open a link. I can drive the game, take screenshots and run tests the way both earlier projects did.
- Electron wraps the same build as a Windows, Mac and Linux app, with Steamworks (achievements, cloud saves) through a native binding. Browser games have shipped on Steam this way.
- Godot was the alternative. It has a better editor and native builds, but I cannot play-test it from VS Code, and the build, test and screenshot loop is what has made both earlier projects work.

How it is built:
- **Simulation apart from rendering.** The world (crops, people, weather, prices, threats) runs on a fixed tick in plain TypeScript with no drawing code. The renderer reads it. This makes tests fast and GPU-free, makes sleeping and time-skips cheap, and lets the later transport and city layers run in a worker.
- **Content is data.** Items, crops, recipes, people, quests, dialogue, places, enemies: JSON, validated on load. Code reads data.
- **Saves.** Versioned schema with migrations (from Hammerfell). IndexedDB in the browser, files on disk in the desktop build so Steam Cloud can sync them. Autosave plus slots. Export and import kept.
- **Input.** Keyboard and mouse, and a controller from the first build. Rebindable.
- **Screens.** Designed at 1280 by 800 (Steam Deck), scaling up. UI text readable on the Deck.
- **Test hook.** `window.__game` for Playwright, as before. A test per feature, a regression list, and an IP check.

## 5. The look

**Proposal: isometric**, like the Hammerfell art sample, not the top-down view of Wasteland Settlement.

- Fields, fences, roads and later rail and towns read far better at an angle. Transport and city games are almost all angled for this reason.
- Hammerfell already has the pipeline: true isometric ground and buildings, characters drawn from a posed rig in eight directions with swappable layers, cast shadows and a light map.
- It sets the game apart from the many top-down farming games on Steam.
- The cost: every asset is drawn at an angle, vehicles need eight directions, and clicking a tile needs a careful hit test. All solvable, and the rig covers characters.

Compare `docs/baseline/wasteland-0.12-camp.png` with `docs/baseline/hammerfell-art-sample.png`. The second is the starting quality bar, not the finish line.

**Art plan:** code-drawn art for structure and first quality (layers, directions, animation, lighting), with the option to pay an artist to paint over key assets later (faces, the player, hero buildings, store capsules). The Hammerfell art report reached the same conclusion: strong on hard shapes, weak on faces, cloth and animation. The game reads only PNG sheets and JSON atlases, so swapping art never touches game code.

## 6. Gameplay: what changes

### Farming
- **Soil per tile:** fertility, moisture and contamination. Tainted soil grows tainted crops, which sell cheap and are risky to eat. Clean it by hauling topsoil, composting, or growing remediation crops (sunflowers are used for this in real life). A farming puzzle no other farm game has.
- **Seasons and weather:** dry and wet seasons, dust storms, ash rain, frost, heat. A forecast on the radio.
- **Seeds as progression:** the story says the seeds matter more than you do. Collect heirloom stock from ruins and survivors, save seed, and breed for traits (drought-hardy, contamination-tolerant, heavy yield).
- **Quality grades** that set price and food value. **Processing** (drying rack, mill, still, cannery) for goods worth trucking.
- Water (wells, pumps, pipes, purity) and livestock carried over and deepened.

### People
- Farmhands turn up at the gate, drawn by your food. You meet them: skills, traits, a wage they ask for, and something they are not telling you.
- You assign them to work areas with priorities. They keep schedules: work, eat, sleep.
- Needs: food, a bed, safety, pay, morale. Underpay or overwork them and they slack, steal, leave, or take others with them. They get hurt, and if the setting allows, die. Others grieve.
- Farmhands grow into guards, mechanics, medics and drivers. That workforce is what the city layer runs on later.
- Beds, food, water and defence add up to capacity, and capacity is what the story asks for.

### Threats and combat
- **A threat budget** that grows with your wealth and your noise: lights after dark, the generator, trucks on the road, and how close you are to the broadcast.
- **Husks** come at night, slow and many, drawn to light and sound. Lights help you see and draw them in.
- **Raiders** plan: they scout first, then go for stores, livestock and convoys. You can fight them, pay them, bargain, recruit them or wipe them out. Each has reputation consequences.
- **Defence:** walls, gates, lights, towers, traps, alarms, and guards on shifts.
- **Fighting in person:** light and heavy attacks, block, bash, dodge (from Hammerfell), firearms with scarce ammunition, stamina. Balanced with the model so that prepared players win narrowly at every tier, including the top.
- **Expeditions:** ruins hold machine parts, fuel and seed stock, which the next tier needs.

### Trade and trucks
- A depot on your land. Trader convoys from the Hull call on set days and buy what is in it. Prices move with demand. Contracts ask for set amounts by a set day.
- The road between you and the Hull can be ambushed, needs repair, and can be patrolled or escorted.
- Later you own a truck: salvaged, thirsty, and a target. Then routes. This is where the transport layer starts.

### Fixes from the 0.12 known limits
Animals defend or flee during raids. Townsfolk path around things instead of walking straight lines. Reputation rises and falls from more than the job board. Harming townsfolk has consequences.

## 7. The quality bar

What makes it feel like a paid game:
- Every action has feedback: animation, sound, particles, a little camera.
- 60 frames a second on a Steam Deck, and no hitch when new ground loads.
- Fully playable on a controller. Readable at 1280 by 800.
- Rebindable keys, text size, colour-blind safe palettes, subtitles, the gore setting.
- Day and night lighting, weather, ambient sound for each area.
- A hand-dressed valley that looks lived in, not scattered props.
- No debug text or placeholder UI in a release build.
- Saves are never lost: autosave, slots, Steam Cloud, export.

## 8. Steam checklist

- Steam Direct fee: US$100 per game, recouped after US$1,000 in sales.
- Steamworks sign-up with bank and tax details.
- A store page marked Coming Soon well before launch. Wishlists decide how much Steam shows the game at launch.
- A demo for a Steam Next Fest.
- The content survey: frequent violence and gore declared, adult age gate. No sexual content, as now.
- AI disclosure for any generated art, audio or voices (the ElevenLabs voices count).
- A trademark search on the title before announcing it.
- Store capsule art and a trailer. Worth paying an artist for the capsule even if nothing else is bought.

## 9. Roadmap

Each phase ends with a playtest build, screenshots and a short report. Order can change with reasons.

| Phase | What | Ends with |
|---|---|---|
| **0. Spikes** | (1) An isometric farm slice in PixiJS: one valley chunk, till, plant, water, grow, the rig walking in eight directions, day and night with the light map. Measured at 2,000 crop tiles, 40 people and 12 vehicles, with a slowed CPU standing in for a Deck. (2) Art gate: the player, a farmhand, a Husk, a raider, a farmhouse, a field in four stages, a truck in eight directions. (3) Combat arena: melee and firearms against Husks and raiders. (4) Desktop build: Electron app, saves on disk, controller, 1280 by 800. (5) Data import: Wasteland tables to JSON with the renames applied, and the IP check. | A report and screenshots for approval |
| **1. The homestead** | The valley map, the full farming loop (soil, seasons, weather, seeds, quality, processing), building, early crafting, survival needs, saves, title, the 18+ gate, settings | Playtest 0.1 |
| **2. People and threats** | Farmhands, needs, work areas, morale; the threat budget, Husks, raiders, defence, guards | Playtest 0.2 and 0.3 |
| **3. Trade** | The depot, convoys, prices, contracts, the road, the Hull | Playtest 0.4 |
| **4. Story** | Chapters One to Three on the new map, regions and dungeons | Playtest 0.5 and 0.6 |
| **5. Steam** | Store page, Steamworks, achievements, cloud saves, Deck checks, the demo | Coming Soon page and demo |
| **Later** | Owned trucks and routes (transport), towns and zoning (city), Chapter Four and the endings | |

## 10. Questions for Broden

1. **The look:** isometric (recommended), or keep top-down?
2. **Title:** "Long Table" is a codename. Candidates to search before deciding: The Long Table, Eleven Tags, Unit Eleven, Cradle Valley. Or your own.
3. **Art:** code-drawn now with an artist painting over key assets later (recommended)? Any AI-generated art or voices? Both are allowed on Steam with a disclosure, but it is your call.
4. **Repo and playtests:** a new private GitHub repo for this. GitHub Pages from a private repo needs a paid GitHub plan, and the site is public anyway. A password-protected itch.io page is free and keeps playtests private.
5. **Renames:** approve the must-change list in section 3. Final names get picked during the Phase 0 data import, and you can veto any of them.
