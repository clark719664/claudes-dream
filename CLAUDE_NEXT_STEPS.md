# Claude: continue Hearthwild on this branch

Branch `codex/hearthwild-claude-handoff-2026-09-27`. The PixelLab curation, the building rewrite, furnished interiors and the first 480x270 UI pass are done and tested — read section 10 of `CLAUDE_HANDOFF_HEARTHWILD.md` for exactly what exists and how it was verified. The user has delegated appearance choices; continue without asking them to repeat the brief.

## Run things

```
G=C:/Users/lil_c/Tools/Godot-4.4.1/Godot_v4.4.1-stable_win64_console.exe
python game/tools/curate_pixellab_assets.py          # re-curate after editing tools/curation_config.json
"$G" --headless --path game --import
"$G" --headless --path game res://tests/test_buildings.tscn       # 212 checks
"$G" --headless --path game res://tests/test_strain_crops.tscn    # 48 checks
"$G" --headless --path game res://tests/test_preferences.tscn -- --test-mode   # 21 checks
"$G" --headless --path game res://tests/test_areas.tscn           # 27 areas
"$G" --path game res://tests/visual_review.tscn -- --out=<dir>    # real renderer, 33 screenshots
```

Grep every log for `SCRIPT ERROR` / `ERROR` yourself; the summary lines print even when something errored.

## Next

1. Merge the three remote-only commits on `origin/claude/game-engine-ai-design-gh3z6p` deliberately (they overlap world.gd, player.gd, interior.gd, hud.gd, inventory.gd). Re-run every suite after.
2. A scripted end-to-end run through the real UI: buy seeds in the shop, till, plant, water across days, harvest, ship, sleep; rebind a key, restart, confirm it stuck; New Farm confirmation.
3. Fix `tools/worldgen/town.py` lots to match `tools/patch_town_layout.py` before anyone regenerates the world.
4. Visual polish still open: distinct wall/floor styles per interior, the shop list's partial last row, ladder-looking fence runs in town, farm placement checks only one cell.

Pixel Crawler Free Pack 2.11 is included per the user's direction and credited to Anokolisa in `CREDITS.md` and on the title screen. Keep that credit.
