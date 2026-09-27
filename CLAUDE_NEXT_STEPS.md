# Claude: continue Hearthwild on this branch

Start from `codex/hearthwild-claude-handoff-2026-09-27`, latest known code checkpoint `06185d61`. Do not start from the original branch or discard local work. The detailed project handoff is `CLAUDE_HANDOFF_HEARTHWILD.md`; its older sections 10–16 contain stale stop-state text. The current checkpoint already includes title/settings/keybindings, first-pass HUD, recovered actors, PixelLab source archive, credited Pixel Crawler art, and growable strain crops.

The user asks for a complete Stardew-level visual pass and has already delegated appearance choices. Continue without asking them to repeat the brief.

## Highest priority: finish PixelLab curation

Archive: `ArtSource/PixelLabArchive/2026-09-26` (347 complete assets). Original exports live in UUID folders. Choose exact UUIDs and view PNGs; never interpret an eight-view object strip as eight animation frames. Preserve archive originals and the strain catalog overlay.

Implement a repeatable `game/tools/curate_pixellab_assets.py` and checked-in editable config. For every output record source UUID/name, view, relative path and SHA256, crop bounds, output dimensions/path and SHA256, catalog keys, feet anchor and gameplay footprint. Use a single direction PNG, alpha bounds, nearest-neighbor resizing, correct metadata anchors and one selected view. Fail on missing required sources, report skipped optional ones, preserve gameplay fields, and reapply `game/data/strain_catalog.json` last.

Prioritize selected buildings: detailed chicken coop, red barn, glass greenhouse, windmill, silo, wishing well, library, wizard tower, manor, clinic, general store, blacksmith, tavern, bathhouse, museum, inn, school, church. Prioritize named interior furnishings: fern plant, tavern table/bar, library desk, inn bed, hot spring pool, school desk, museum case, church pew, clinic bed, store counter, forge anvil. Then use matching 16px icons for items/tools/food that actually exist in the game. Review garlic WEST because its SOUTH export contains stray `IMAGE_TYP` text. Preserve the selected strain nuggets: sativa Green Crack UUID `01cb8e15-1863-486c-b470-837f8f4b35dd` south; hybrid OG Kush `ad155a81-6199-4d9c-9851-fef03732133b` south-east; indica Grand Daddy Purp `18bb9cb1-4efe-46fa-8276-997b37d7bfda` south.

Replace `game/scripts/custom_building.gd`'s eight-frame assumption. Keep its constructor, `entered` signal and `building_id` contract (`world.gd` constructs with `o.kind`, then connects `entered` to `go_to(o.kind, "door")`). Read dedicated building texture/size/feet/footprint/door metadata. Put feet at the origin, keep the entrance clear, and emit `entered` only after the player presses `interact` inside the door area. Retain a catalog-region fallback for uncurated definitions. Preserve `interact()` if callers need it. Wire selected furniture to `interior.gd`; use `Pack.texture()` for base-pack paths.

The archive index at `C:/Users/lil_c/pixellab-recovery/object-index.json` is outside Git. For a reproducible script, derive a minimal id/name index from the archive metadata when none is passed, or commit a small id/name index. Do not include recovery scripts or API credentials.

## Then personally review the visuals

Use Godot at `C:/Users/lil_c/Tools/Godot-4.4.1/Godot_v4.4.1-stable_win64_console.exe`. Import the game, run crop tests (48 checks) and preference tests (21 checks), then load all areas. Inspect logs for runtime errors; the area harness can print its total even when an individual region logged an error. Launch `game/tests/visual_review.tscn` with a real renderer and inspect title, settings, controls, cabin, farm, inventory, town and shop at 480x270. Fix clipped text, modal/row overflow, wrong scale, mismatched pixel density and missing furniture/actor art. Test an actual door traversal, seed purchase, watering/growing/harvest/shipping, rebind/restart persistence and New Farm confirmation. Update `CLAUDE_HANDOFF_HEARTHWILD.md` to remove stale status and push completed work on this branch.

Pixel Crawler Free Pack 2.11 is included per the user's direction and credited to Anokolisa in `CREDITS.md`. Keep that author credit and do not claim authorship of those assets.
