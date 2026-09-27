# Hearthwild — Claude implementation handoff

Prepared 2026-09-26. User stopped Codex because credits were low and explicitly requested an extremely detailed handoff. This document is an implementation brief, not a claim that the requested upgrade is finished.

## 1. User intent and authorization

The user asked to inspect branch `claude/game-engine-ai-design-gh3z6p`, find all Hearth work, secure all PixelLab assets, select the best artwork for every applicable game object, and take ownership of the game after Gemini and Claude stopped working. They want a polished Stardew-quality farming game and UI. Specific requirements:

- Recover and retain every PixelLab source asset, including the multiple views in each object spritesheet.
- Choose which views and variants look best for actual game use. Do not display an entire eight-view strip as one object or blindly assume every image has eight horizontal frames.
- Turn their nug artwork into three growable fictional game crops: sativa, hybrid, indica. They explicitly said to choose the strain mapping based on appearance. Show recognizable buds on foliage/stalks as plants grow.
- Use the best appropriate artwork for buildings, props, tools, food, animals, characters, inventory icons, and other implemented content.
- Polish the whole UI to match the cozy pixel-art world.
- Add a start screen with settings available before starting play.
- Add persistent settings and editable keybindings, with a Controls section.
- Remove the persistent on-screen button legend and put that information in Controls.
- Continue autonomously within this scope. Do not ask them to approve ordinary implementation choices again.

The user provided a PixelLab API credential earlier. It is intentionally NOT copied into this document or source code. The complete archive is local; finishing integration should not require another download or generation request. If account access becomes necessary, use the existing authorized credential through a secret/environment mechanism, never commit it or print it.

## 2. Repository, branch, and preservation rules

Repository: `C:/Users/lil_c/claudes-dream`
Game project: `C:/Users/lil_c/claudes-dream/game`
Branch: `claude/game-engine-ai-design-gh3z6p`
Local HEAD at initial inspection: `f8827aa`
Fetched remote branch tip at initial inspection: `f64d85cb585958c99344cd5934e86f8c2d881e2c` (three commits ahead at that time).

This checkout contains extensive pre-existing Gemini/Claude edits and untracked assets. Initial state was approximately 339 modified and 419 untracked entries; a later status count was 767. DO NOT reset, clean, switch branches, or replace files wholesale from remote. Do not assume a diff against HEAD contains only Codex work. No commit, push, PR, deployment, or merge was made by this session. No such external action was requested.

Fresh status snapshot: `C:/Users/lil_c/pixellab-recovery/handoff-git-status.txt`.
Earlier inventory of Hearth work: `C:/Users/lil_c/hearthwild-inventory-2026-09-26.txt`.
Original backups of several files changed by Codex: `C:/Users/lil_c/pixellab-recovery/before-game/`.

Three Codex workers were interrupted for this handoff: asset_integration, settings_start, ui_polish. They initially hung on their first elevated read approvals for roughly 20,000 seconds and reported that no implementation files had been changed. Root restarted them, but the final handoff inspection still found NO preferences/settings script, NO curation script, NO worker report, the original main scene, and the original HUD controls legend. Do not treat worker assignments or proposed architecture as completed work. They have been explicitly interrupted again so Claude can take over.

## 3. Runtime and environment

Windows PowerShell, project under writable user directory.
Godot installed by this session:
`C:/Users/lil_c/Tools/Godot-4.4.1/Godot_v4.4.1-stable_win64_console.exe`

Python with Pillow:
`C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`

General recovery workspace and logs:
`C:/Users/lil_c/pixellab-recovery/`

The Codex Windows sandbox repeatedly failed before commands could run with `SetTokenInformation(TokenDefaultDacl) failed: 1344`. Root commands executed successfully using the official `require_escalated` path. Worker escalation requests could hang indefinitely even while root approvals executed quickly. Do not waste hours waiting silently on a worker approval: execute the command from the primary agent or use the normal permissions mechanism of your own environment. Do not bypass security controls. Hidden Godot previews were launched with `Start-Process -WindowStyle Hidden`, with logs redirected and a bounded wait.

User AGENTS.md requires local LLM delegation for mechanical work. Ollama at localhost:11434 was checked and was DOWN. This was already disclosed to the user. The wrapper actually found was under `.claude/tools/llm.cmd`, despite instructions mentioning `.Codex/tools`. If the service is back, use it for targeted extraction/boilerplate and verify the results. Do not read huge files repeatedly, dump the full dirty diff, or ask a local vision model to judge layout. Use rg and targeted ranges. JSON files such as world.json may have huge single lines: Select-Object -First does NOT meaningfully bound those. Parse JSON and print only relevant keys.

## 4. Complete PixelLab archive — finished and verified

Archive root:
`C:/Users/lil_c/claudes-dream/ArtSource/PixelLabArchive/2026-09-26`

Recovered all 347 completed assets:
- 160 characters
- 148 objects
- 25 top-down tilesets
- 13 sidescroller tilesets
- 1 pro tileset

Independent verification: 7,587 PNG files, 608 ZIP files, 9,393 checksummed payload files, ZERO verification errors. Character rotation and animation frame counts were checked against API metadata for all 160 characters.

Nine failed character jobs were also retained as metadata. Eight have completed same-name replacements. `refugee_crow` has no completed replacement; 48 surviving animation frames were recovered under its partial_frames directory. Do not claim that failed job is a complete character.

The archive retains asset UUIDs to avoid overwriting same-name variants. Typical object layout:
`objects/<uuid>/metadata.json`
`objects/<uuid>/original/<slug>/rotations/south.png` and other directions
`objects/<uuid>/spritesheet/...png` and accompanying JSON
`original.zip` / `spritesheet.zip`

Some legacy single-view objects instead have `original/rotations/unknown.png`. Four old objects returned PNG data from the download endpoint, not ZIP data; handled correctly. Do not assume eight directions universally.

Sidescroller prebuilt download links failed with storage authorization errors. These were recovered from authenticated per-tile PNGs and reconstructed losslessly with official bounding-box metadata. Notes and individual tiles remain in the archive. Top-down sheet retrieval used the authenticated inline image endpoint. No paid generation was used for archival recovery.

Account map inventory: one empty Untitled Map, zero painted cells. Isometric and UI-panel asset listings were empty; old UI artwork exists among objects.

Archive reports:
- manifest.json
- verification.json
- checksums.sha256
- local-comparison.json
- README.txt
- map-inventory.txt (if checking ancillary inventory)

134 recovered assets matched existing game files by UUID or exact image bytes. Unmatched does NOT prove absent: transformed/resized imports will not byte-match.

Recovery scripts in the recovery workspace include probe.py, recover.py, recover_partial.py, recover_sides.py, finalize.py, verify.py. Initial main recovery ran all downloads but crashed printing a Unicode result; finalization rebuilt the correct manifest and verification independently. Do not rerun the entire download just because that first log ended with an encoding exception.

## 5. Existing licensed base pack — restored

The game depended on a local Pixel Crawler free pack that was absent. Restored official free pack 2.11 from the author's Itch page:
https://anokolisa.itch.io/free-pixel-art-asset-pack-topdown-tileset-rpg-16x16-sprites

ZIP: `C:/Users/lil_c/pixellab-recovery/Pixel-Crawler-Free-Pack.zip`
Extracted: `game/assets/Pixel Crawler - Free Pack/`

Keep its existing redistribution exclusion. `game/.gitignore` excludes `assets/*` and whitelists project-generated folders. Codex added exceptions for `assets/curated/` and `assets/pixellab_crops/`; the base pack remains ignored. Do not accidentally commit the downloaded pack.

## 6. Visual selection already made

Contact sheets and inventory:
`C:/Users/lil_c/pixellab-recovery/bud-views.png`
`objects-1.png`, `objects-2.png`, `objects-3.png`
`object-index.json` (148 objects with metadata)

Codex visually reviewed these. General findings: detailed building variants look better than simplified duplicates; most food/tool art is strong. One garlic object's south view has stray `IMAGE_TYP` text above it; choose another clean view rather than importing the defect. Four old gothic UI pieces do not fit the requested cozy style, so do not force every archived image into the game merely because it exists.

User-approved appearance-based fictional strain mapping:
- Sativa: Green Crack, bright emerald bud, UUID `01cb8e15-1863-486c-b470-837f8f4b35dd`, SOUTH view.
- Hybrid: OG Kush, gold/olive bud, UUID `ad155a81-6199-4d9c-9851-fef03732133b`, SOUTH-EAST view.
- Indica: Grand Daddy Purp, purple bud, UUID `18bb9cb1-4efe-46fa-8276-997b37d7bfda`, SOUTH view.

The fourth bud, 9 Lb Hammer UUID `134f500a-ef6c-4c96-9d21-aa78c08fdef8`, was less legible gray/brown and was not selected. This mapping is for the fictional game's visual distinction, not real horticultural claims.

## 7. Strain artwork pipeline — implemented

New foliage generated once using built-in ImageGen, with the bud contact sheet only as style reference. Original:
`ArtSource/StrainGrowth/foliage-original.png`
Generated source also exists at:
`C:/Users/lil_c/.codex/generated_images/01a0df01-77be-7ce1-ac14-77097a374ef2/exec-07bcc1f1-c9f5-415d-b0ec-b96d58364ea1.png`

Actual source is 1254 x 1254 RGBA. Three rows of four stages, with a blank fourth row: tall emerald sativa; medium olive hybrid; compact dark jade/purple-stem indica. Four foliage stages: sprout, juvenile, branching, mature. No buds painted into generated foliage; the exact PixelLab buds are separate overlays.

Reproducible importer: `game/tools/import_strain_assets.py`
Output:
`game/assets/curated/strains/sativa_growth.png`, hybrid_growth.png, indica_growth.png
`game/assets/curated/strains/sativa_bud.png`, hybrid_bud.png, indica_bud.png
`game/data/strain_catalog.json`

Growth sheets: four 32x48 cells in a 128x48 sheet, foot anchor [16,46]. Heights by stage: sativa [7,17,28,40], hybrid [7,16,24,33], indica [7,14,21,28]. Maximum widths 24/26/28. Bud icons are 16x16, exact source artwork cropped and scaled with nearest-neighbor.

Source has low-alpha noise outside plants. Import bounding detection uses alpha >=128 to find three row bands and per-cell occupied bounds. Initial nearest-neighbor reduction made stems/leaves fragmented. Latest foliage import uses BOX reduction then binary alpha >=72 for a crisp, denser silhouette. Original source remains unchanged. Latest visual preview was visibly better and more legible at native resolution. README was written before this last resampling improvement, so update its processing description if necessary.

Importer also registers six existing 64x32 vegetable growth strips from `assets/pixellab_crops/`: corn, eggplant, onion, pumpkin, strawberry, tomato. Four 16x32 frames, anchor [8,31]. Both singular `_seed` and plural `_seeds` icon aliases registered.

Root merged strain_catalog sprites/items into `game/data/catalog.json`. A future curation script MUST preserve/merge this overlay after its other catalog transformations. Do not regenerate catalog from an older builder and silently erase crops.

Visual evidence:
`ArtSource/StrainGrowth/import-preview.png`
`C:/Users/lil_c/pixellab-recovery/crop-growth-game.png` (old thin version)
`C:/Users/lil_c/pixellab-recovery/crop-growth-game-refined.png` (latest in-engine version)

## 8. Crop gameplay — implemented and tested

Modified `game/scripts/inventory.gd`:
- Added names for three buds and singular/plural seed aliases.
- Added CROPS entries for three strains and six existing-art vegetables.
- Sativa seasons 0/1/2, 9 watered days, seed150, sell240.
- Hybrid seasons 0/1/2, 8 days, seed200, sell300.
- Indica seasons 0/1/2, 7 days, seed150, sell220.
- Tomato seasons1/2 days8 seed40 sell80; corn1/2 days10 seed50 sell90; pumpkin2 days13 seed100 sell320; strawberry0 days7 seed50 sell90; eggplant1/2 days7 seed45 sell95; onion0/2 days6 seed35 sell70.
- Added six vegetables to VEGGIES; strains are not generic cooking vegetables.
- Added crop_for_seed(item) that accepts either suffix only when the resulting kind exists in CROPS. is_seed delegates to it; unknown fake seeds are rejected.
- Dispensary now sells canonical plural strain seed IDs.
- tint returns WHITE for catalog item sheets starting curated/ to preserve original artwork colors.
- sell_price checks CROPS before PRICES, so older PRICES values do not override strain crop prices.

Modified player.gd `_plant`: resolves crop via crop_for_seed, rejects invalid before accessing CROPS.
Modified soil.gd `plant`: rejects unregistered crop kind.
Modified crop.gd `refresh`: uses dedicated crop sprite instead of a placeholder; adds exact bud icon children at budding/maturity; mature fertilized scale1.35. `_add_buds`: one small bud at budding; three larger buds at maturity with positions based on strain height. Generated strains skip the old random seed-dot draw overlay.

Tests: `game/tests/test_strain_crops.gd` and `.tscn`.
Latest actual result: `CROP TESTS: 48 checks, 0 failures` in `crop-green.log`.
Covers registration, both seed aliases, dedicated art, invalid-seed rejection, planting, occupied-cell rejection, no growth without water, no early harvest, watered maturity, harvest yield/removal, selling, original icon tint, curated sheet use, winter withering/removal.
This tests in-memory state and does not overwrite the user's save.

Known limitation: other pre-existing store items such as barley/hops/sugar/hemp seeds were not made growable by this work. Audit those against the real catalog rather than claiming every legacy seed works.

## 9. Pre-existing baseline errors repaired by root

npc.gd: removed duplicate second LOVES/HATES constants; inserted missing SCHEDULES from the existing tools/inject_schedules.py literal. Existing generator's search target did not match `const HATES :=`, so schedules had never landed. Seven actor schedules recovered. No invented redesign of NPC behavior.

cabin_fixture.gd: fixed malformed indentation in bathhouse_pool match branch.

interior.gd: changed nonexistent Game.catalog references to Pack.catalog; corrected atlas region end coordinates into width/height; replaced out-of-scope texture variable in potion handling with Pack.texture(PROPS); included bathhouse_pool among interactive fixtures; rug dimensions use computed size; latest fix changed tier to Variant and accepts named LAYOUTS keys instead of passing strings into clampi.

mine.gd: corrected Harvestable constructor second argument to integer0; replaced nonexistent ui/icons.png ladders with compact code-drawn pixel ladders; replaced nonexistent fx/glow.png with GradientTexture2D radial light; corrected exit destination heights->mountain; frees enemies/bosses/rocks instantiated but rejected before add_child, preventing some leaks. This is functional repair, not a finished mine art pass.

world.gd: added mine-specific camera room Rect2(-256,-256,512,512). Has NOT yet received start-menu new-game flag handling.

custom_building.gd: renamed illegal Node.get_name()->String override to display_name(). Full visual rewrite is NOT done: it still loads a raw pixellab_objects/<id>.png, assumes hframes=8, and uses fixed collision160x60.

Fresh import after initial repairs and crop integration had no parser errors. Later full-area testing found runtime issues below. Do not equate parser success with complete game functionality.

## 10. Current failing area test — exact next bugs

Created `game/tests/test_areas.gd` and `.tscn`, which extend world.gd and load 27 interiors/outdoor regions/mine in a fresh game. They print AREA BEGIN/AREA OK and final count. IMPORTANT: Godot runtime errors do not necessarily fail the process and this harness currently prints AREA OK even when a build method aborted. Inspect logs for SCRIPT ERROR and ERROR, and improve the harness before treating it as a green test.

Latest log: `C:/Users/lil_c/pixellab-recovery/area-smoke-2.log`.

Still failing:
1. `Interior._furniture`, around line190: `sp.texture = load("res://assets/" + d.sheet)` bypasses Pack's base-pack fallback. Replace with `Pack.texture(d.sheet)` while retaining correct region rectangle. This exact small fix was identified but NOT applied before handoff.
2. `Interior._furniture` also references missing sprite key `plant`. Select and catalog an appropriate recovered plant, or correct the mismatched key to its actual existing counterpart; don't just hide the exception.
3. Missing actor catalog keys observed across runs: bear, bee, butterfly, cave_bat, cave_snake, chicken, dog, forest_wolf, frog, green_forest_slime, horse, rock_slime, stone_based_slime, tabby_cat. Pack.frames directly indexes catalog.actors and errors; Enemy/FarmAnimal then call has_animation on null. Recover/map the correct actors and animation layouts from the complete archive. Do not substitute unrelated creatures just to silence errors.
4. Many additional mine biomes use actors beyond those exercised by the first mine. Audit all referenced actor names, including deeper-floor boss pools, not just the observed list.
5. Existing resource/node leaks remain at shutdown. Some mine discarded-node leaks were fixed, but the most recent log still mentions CanvasItem/ObjectDB cleanup. Use verbose diagnostics after functional errors are clean.

Named interior clampi failure and missing mine UI/glow images are absent from the second log, confirming those fixes reached execution.

Mine caveat: mine rendering is still an unfinished flat-color procedural area, with potentially incomplete collision/camera/world-size behavior inherited from earlier work. A claimed polished production game would require a visual/playability pass there. Mine entrance lives in mountain, not a nonexistent heights area. Verify the `mine` return spawn resolves to a sensible mountain location; changing the destination name alone was not an end-to-end door traversal test.

## 11. Asset integration still to do

No curation tool has landed. Create a reproducible import/selection pipeline, e.g. `game/tools/curate_pixellab_assets.py` plus a human-readable selection manifest. Keep originals immutable in ArtSource. Work from all UUID variants and direction metadata. Choose views for readability, coherent viewpoint, pixel density, feet anchors, and footprint. Do not simply choose the newest variant everywhere.

Audit catalog sprites/items/actors/stations against the archive and actual game references. Existing catalog has many already imported characters, but name mismatches are producing missing actors. Preserve working animation mappings and add the absent source assets. Do not overwrite all actors unnecessarily.

For buildings, rewrite CustomBuilding to consume selected catalog sprites and source-specific metadata, not a hardcoded eight-frame strip. Correct texture cropping, origin at feet, scale, visual footprint, collision, entrance interaction and door location. Keep player collision/door access sensible. Check world spawn paths use the curated result. Building art cannot merely be present in a directory: it must actually be used.

For inventory, preserve original colors with Inventory.tint's curated/ exception. Check every shop/crafting icon resolves. Food/tool assets should be readable at16px; keep pixel edges crisp and transparent bounds tight. Avoid unreadable crops from giant sheets.

Select matching furniture for named interiors and ensure all their keys exist. The current custom building/import code is one of the clearest unfinished areas.

Merge strain_catalog overlay LAST. Record each selected source UUID/direction, destination, and reason. Validate all referenced files, all atlas bounds, all actor frame layouts, and all expected animation names. Keep unselected source variants archived rather than deleting them.

## 12. Start/settings/Controls — not implemented

Final check: project.godot still uses `res://scenes/main.tscn`; no Preferences autoload; no settings files. Implement from scratch while preserving existing game behavior.

Recommended design (not code already present):
- Start screen: Continue (disabled/no-save state clear), New Game, Settings, Controls, Quit.
- Settings available before play and in-game through a compact menu button/Escape when no other modal owns Escape.
- Persist configuration separately from hearthwild_save.json, likely ConfigFile in user://. Handle missing/corrupt config safely.
- Add a Preferences autoload after Game/Inventory so default InputMap bindings already exist before applying saved overrides.
- Video: suitable window/fullscreen options, sensible integer pixel scaling; actual implemented audio volume controls; optional reduced-motion/screen-shake setting only if wired into the real effect code.
- Controls: list actions and current actual bindings; rebind keyboard keys with visible capture state; Escape cancels capture; report key conflicts clearly; provide reset defaults and cancel/back; preserve existing mouse/controller mappings unless intentionally editing those too.
- Ensure remapped actions work in real play, persisted after restart, and UI labels update.
- New Game must not immediately destroy an existing save merely by entering the menu. Confirm replacement when applicable. Starting a new run should reset ALL world/global state, not just date/inventory.
- Existing Game.new_game only resets day/time/gold/energy/weather/inventory: explicitly reset areas, shipped, earned, goal/stats, opened, upgrades/cabin tier, springs, buffs, station tiers, relationships, timers as appropriate.
- Existing World._ready ALWAYS calls Game.load_game, then Game.new_game if false. Add a consumed startup intent flag to bypass loading for an explicitly selected New Game. Otherwise a New Game button will accidentally reload the old save.
- Opening settings pauses gameplay; closing restores the prior pause state instead of blindly unpausing another dialog. Prevent input leaking through overlays into tools/movement.
- Keep Continue/load compatible with existing v5 saves.

Current default actions defined in Game._ready:
move_left A/Left; move_right D/Right; move_up W/Up; move_down S/Down; attack J/Space + left mouse + padX; interact E/Enter + right mouse + padA; eatQ + padY; sprintShift + right shoulder; craftC + left shoulder; inventoryI/Tab + padBack; mapM + padStart; cancelEscape + padB; slot_next wheelDown + dpadRight; slot_prev wheelUp + dpadLeft; slot_0..slot_9 keys1..0. Preserve the existing controller axes as well.

## 13. HUD/UI polish — not implemented

Final check: hud.gd still contains its six-line WASD/SHIFT/SPACE/E/C/I/M/Q/ESC legend in _build_hint around259-267, with an18-second fade. User explicitly wants that removed and relocated to Controls. Keeping it but making it fade faster is not sufficient.

Visual direction: original cozy woodland farming identity, walnut frames, parchment accents, sage and amber, crisp pixel typography. Current viewport480x270, integer scaling to1440x810, nearest filtering. UI must actually fit this small native canvas; do not transplant oversized web layouts. Prefer consistent theme helpers reused by HUD, start screen, settings, dialogs and menus.

Polish health/energy/level, date/weather/clock/gold, goals, toolbar selection, inventory, crafting, shops, shipping, map/travel, dialogs, and social screen. Use actual best icons. Ensure text contrast, selection/focus feedback, mouse and keyboard usability, readable quantities/prices, constrained dialog text, scrolling for longer lists and no off-screen rows.

HUD landmarks (line numbers will change after edits): _panel120, _label136, _icon143, _bar153, _build_status173, _build_clock211, _build_strip239, _build_toast249, _build_hint259, _refresh_items269, _build_dialog318, _build_menu370, _open428, _unhandled_input449, _fill_social504, _refresh_menu623, _fill_inventory733, _fill_shop835, _fill_ship886.

Social bug: HUD reads Game.relationships, but that property does not exist in current Game. Add correct state/save/load/new-game handling and daily gift reset consistent with actual NPC usage. Inspect npc.gd for exact fields rather than inventing a conflicting shape.

## 14. Verification commands and evidence

From repository root in PowerShell:

```powershell
$godot = 'C:/Users/lil_c/Tools/Godot-4.4.1/Godot_v4.4.1-stable_win64_console.exe'
$python = 'C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python game/tools/import_strain_assets.py
& $godot --headless --path game --editor --import --quit
& $godot --headless --path game res://tests/test_strain_crops.tscn --quit-after 120
& $godot --headless --path game res://tests/test_areas.tscn --quit-after 200 -- --new
```

Redirect logs to files, inspect error lines, and verify expected completion output. Exit0 alone is not proof of a successful Godot runtime test. `rg` exits1 if no matches; don't confuse that with a failed Godot process when composing commands.

Crop screenshot scene: `game/tests/visual_strains.tscn`. It renders three rows/four stages and writes the current hardcoded path `C:/Users/lil_c/pixellab-recovery/crop-growth-game-refined.png`, then quits. It sets Game.world=null to avoid clock progression. It needs a real rendering backend; headless dummy rendering cannot produce meaningful screenshots. Make output path configurable/portable if retaining as a durable project tool.

Example hidden rendering:
```powershell
$p = Start-Process -FilePath $godot -ArgumentList '--path','C:/Users/lil_c/claudes-dream/game','res://tests/visual_strains.tscn','--quit-after','120' -WindowStyle Hidden -PassThru -RedirectStandardOutput C:/Users/lil_c/pixellab-recovery/preview.log -RedirectStandardError C:/Users/lil_c/pixellab-recovery/preview-errors.log
$p.WaitForExit(30000)
```

Existing game/scripts/demo.gd can automate tours/screenshots using user args --demo --new --shots=..., or --area=farm --mapshot=... --region=x,y,w,h --mapscale=2. Inspect before use; menus added later must preserve a useful test bypass. Avoid writing to the user's real save/config during tests. Existing --new makes load_game skip the save but does not universally sandbox all later writes; don't invoke sleep/save in a test without an isolated user-data strategy.

Important logs:
- baseline-import.log / import-after-baseline.log: old initial failures
- crop-green-import.log: clean parser import at crop milestone
- crop-green.log: 48 checks,0failures
- crop-visual.log / crop-refined.log: screenshot runs
- world-smoke.log: initial house-only run, shutdown leaks
- area-smoke.log: first27-area test, many errors
- area-smoke-2.log: latest test, named interiors/mine resource errors fixed, remaining actors/furniture failures listed above

## 15. Suggested execution order

1. Confirm branch and preserve all dirty work; read this handoff and targeted current code, not every report.
2. Apply the identified Pack.texture furniture fix and register/match missing plant and actors. Audit all referenced actor keys, not only one random mine run.
3. Build the reproducible visual selection/import pipeline; repair building rendering/anchors/entrances and merge crop overlay last.
4. Implement Preferences/start/settings/controls and complete global New Game/relationships handling.
5. Remove HUD button legend and polish all screens with one coherent pixel UI theme.
6. Run import, crop regression, every area, representative deep mine biomes, and UI/rebinding/persistence tests. Fix errors rather than ignoring logs.
7. Render and personally inspect start, settings, Controls, game HUD, inventory, crafting/shop, three crop stages, farm/town buildings. Measure/control overflow at480x270. Improve any incoherent scale or blurry/pixel-dense imports.
8. Play through new game, continue, plant-water-grow-harvest-ship, purchase seeds, visit a shop/interior, enter/exit mine, rebind/use a control, restart and verify persistence.
9. Leave a clear launch route and concise user-facing completion note backed by evidence. Be candid about any unfinished features. Do not call this AAA complete based solely on parser/tests.

## 16. Stop state and immediate instructions to Claude

The user requested this handoff because Codex credits are low. Implementation is intentionally stopped now. Recovery and crop work are concrete; full asset curation, start/settings/keybindings, HUD redesign, missing actor integration, and remaining runtime fixes are still required. All relevant source files and artifacts are in the paths above. Pick up the actual checkout and finish the authorized work without asking the user to restate the brief.


## GitHub handoff update � 2026-09-27

The owner subsequently requested a GitHub push and explicitly requested inclusion of the Pixel Crawler base pack with author credit. This supersedes the earlier exclusion instruction in section5. The unmodified source pack is now included as a project dependency and credited to Anokolisa in CREDITS.md, with the official source and terms links. Preserve that attribution and add in-game credits before release.

Fourteen older PixelLab generator/downloader scripts contained a shared hardcoded credential or fallback. Those literals were removed before publication; the scripts now require PIXELLAB_API_KEY from the environment. Do not restore credentials from older local copies.

The original remote branch contains three commits absent from this local working tree. To preserve both histories without overwriting or attempting a large unreviewed merge, this full work snapshot is published on codex/hearthwild-claude-handoff-2026-09-27. Claude should start from that branch and consult the original branch for the additional remote work; do not blindly reset or overwrite either version.
