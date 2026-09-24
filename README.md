# SKYSTACK

**Stack to orbit. Don't miss.**

A one-tap tower stacker built in Unreal Engine 5. It's made to look incredible in a
10-second clip and to be almost impossible to put down.

A block slides back and forth: tap to drop it. The overhang shears off and tumbles away
under physics. Land it dead-on for a **PERFECT**: the block flashes, sparks fly off its rim
and the note climbs a musical scale.

Every floor also takes you higher into the sky, with a new zone every 15 floors. You start on
a sea cliff at sunrise, rise through a layer of volumetric clouds, stack above them in golden
hour, keep going through a neon-lit night, and reach orbit around floor 90 with the planet
curving below you.

---

## The look

| Layer | What's on screen |
|---|---|
| **Lighting** | Lumen global illumination and reflections, virtual shadow maps, TSR anti-aliasing. |
| **Sky** | A physically based sky atmosphere with a sun and moon, real-time sky light, volumetric clouds, and volumetric fog with light shafts. |
| **Altitude** | The planet (atmosphere, clouds, fog) sinks as you climb. You pass through the cloud layer around floor 20; from floor 90 the sky turns black, stars appear and the horizon curves. |
| **Blocks** | Glossy clear-coat material with glowing bevel seams. The seams brighten at night, so the tower turns neon. Each run uses one of six curated gradient palettes (Lagoon, Candy, Aurora, Ember, Blossom, Coastal). |
| **Effects** | Glowing streak sparks rendered as instanced meshes, rim bursts on perfects, a glowing halo, a gold ring hanging at your record height, and a 1,400-star sky. |
| **Camera** | Cinematic depth of field focused on the tower top, a gentle handheld drift, trauma-based shake, and a field-of-view kick on hits. The camera opens up toward the horizon as the sky gets more dramatic. |
| **Post** | Bloom, lens flare, film grain, vignette and chromatic pulses. When the tower gets dangerously thin, the image warms toward red. |
| **UI** | Slate UI set in Unbounded and Manrope, with frosted-glass panels, pill buttons, a combo meter, an altitude readout, spring-animated callouts, and a blurred game-over card with an animated run grid. |
| **Audio** | A real-time synth. The music builds from pads to a full beat as your streak grows, and every sound effect is generated live. |

## Why it can go viral

- **The journey is the hook.** "I stacked to space" is a screenshot and a clip on its own. Each zone change (Cloud Line, Sea of Clouds, Golden Hour, Nightfall, Stratosphere, Orbit) is a new visual reward.
- **Daily challenge.** Everyone gets the same tower each day: same palette, speeds and twist floors.
- **Wordle-style share code.** SHARE, or the **C** key, copies a result like `SKYSTACK Daily #267: 58 floors, 3.6 km 🚀` plus an emoji grid of the run.
- **Clip-ready fails.** Every miss triggers a slow-motion collapse while the camera pulls back and orbits.
- **CLUTCH moments.** Saving a nearly-missed drop brings slow-mo, a sparks burst and a big callout.
- **A visible rival.** A glowing gold ring hangs at your record height, and the HUD counts down how many floors you need to beat it.

## Controls

| Action | Keyboard / Mouse | Gamepad | Touch |
|---|---|---|---|
| Drop / Start / Retry | Space, Enter, Left Click | A / Cross, Start | Tap |
| Instant restart | R | X / Square | - |
| Choose mode (title) | D, E, arrows, or click a card | D-pad | Tap a card |
| Copy share code | C or SHARE | Y / Triangle | SHARE |
| Menu / Quit | Tab, Esc | B / Circle | MENU |
| Mute | M | - | - |

> In the editor, **Esc** stops Play-In-Editor, so use **Tab** to get back to the menu.

## Build and run

**You need:** Unreal Engine **5.4 or newer**; Visual Studio 2022 with *Game development with C++* (or Xcode on Mac); and a DirectX 12 GPU for Lumen and volumetric clouds (GTX 1070 / RX 5700 class or better).

1. Clone the repo.
2. Right-click `SkyStack.uproject` and choose **Generate Visual Studio project files**. Use **Switch Unreal Engine version...** first if you're not on 5.4.
3. Double-click `SkyStack.uproject` and answer **Yes** to build the `SkyStack` module.
4. **First launch only:** while the editor opens, `Content/Python/init_unreal.py` builds the materials `M_SkyBlock`, `M_SkyGlow` and `M_SkySpark` into `Content/SkyStack/`. Look for `[SkyStack] built ...` in the Output Log. Commit those `.uasset` files.
5. Press **Play**.

**To ship it:** use *Platforms, Windows, Package Project*. The generated materials and the fonts are already set to be cooked and staged.

### If something looks off

- **Blocks look flat and matte, and sparks are white cubes:** the materials weren't generated. Check that *Edit, Plugins, Python Editor Script Plugin* is enabled, then restart the editor and check the Output Log for `[SkyStack]` lines.
- **Too dark or too bright:** exposure is auto with limits. Tweak `AutoExposureMinBrightness` / `AutoExposureMaxBrightness` in the `ASkyStackDirector` constructor, or the per-zone `ExposureBias` in `GZones`.
- **Low frame rate:** use *Settings, Engine Scalability* in the editor, or run `r.VolumetricCloud 0` / `r.Lumen.DiffuseIndirect.Allow 0` in the console to find what's expensive.
- **Compile error:** paste it to Claude.

## Code map

```
Source/SkyStack/
  SkyStackDirector.*   Game rules, sky/altitude system, camera, post, sparks, stars, input
  SkyStackBlock.*      Every solid object: cube + generated material, tweens, physics, flash
  SkyStackUI.*         The whole Slate UI (title, HUD, callouts, game-over card)
  SkyStackHUD.*        Mounts the UI on the viewport
  SkySynth.*           Real-time synthesizer + step sequencer (USoundWaveProcedural)
  SkyStackSave.h       Persistent stats
  SkyStackGameMode.*   Wires up the pawn and HUD
Content/Python/init_unreal.py   Builds the materials inside the editor
Content/Fonts/                  Unbounded + Manrope (SIL Open Font License)
Config/                         Lumen/VSM/TSR, cooking and staging rules
```

### Tuning knobs

The `SkyStackTuning` namespace and the `GZones` / `GPalettes` tables at the top of `SkyStackDirector.cpp` control:
- difficulty (speed curve, perfect window, streak reward);
- the altitude curve (`AltitudeMetersForFloor`);
- per-zone sun angle, colour, moon, seam glow, camera pitch, stars and exposure;
- the gradient palettes.

## Testing without Unreal

Everything that can be checked without the engine is covered here and runs on any machine with `g++`:

| Check | Command | What it proves |
|---|---|---|
| Unit tests | `Tests/run.sh` | ~12,000 checks on the game rules (drop geometry, speeds, altitude, zones, music levels) and the synth (no clipping, every effect audible, voices always released), built with strict warnings as errors. |
| Audio render | `Tests/run.sh render` | Writes the game's real audio to `Tests/out/`: a bot-played run (`run_demo.wav`), every effect (`sfx_sheet.wav`) and the adaptive music (`music_layers.wav`). |
| Difficulty | `Tests/run.sh simulate` | 100,000 bot runs through the real rules at five skill levels. |
| Material script | `Tests/validate_material_script.py` (see its header) | Runs `init_unreal.py` against a fake `unreal` module built from the real UE 5.5 Python API, so every class, property and enum it uses is verified. |
| Compile check | `Tests/compile_check.sh` | Every game `.cpp` compiled against a mock engine (`Tests/MockUE`) whose API was checked against UE 5.5. This catches typos, scoping, argument types and Slate lambda return types. |

The game rules (`SkyStackRules.h`) and the synth (`SkySynthCore.*`) contain no engine types, so the
game and these tests run exactly the same code.

### Difficulty curve (from `Tests/run.sh simulate`)

Players are modelled by how precisely they time a tap (standard deviation of press timing):

| Player | Median floors | Median run | Reach Cloud Line (15) | Sea of Clouds (30) | Golden Hour (45) | Nightfall (60) | Orbit (90) |
|---|---|---|---|---|---|---|---|
| First-timer (70 ms) | 20 | ~25 s | 93% | 1% | - | - | - |
| Casual (50 ms) | 28 | ~32 s | 100% | 36% | 0.4% | - | - |
| Regular (38 ms) | 37 | ~41 s | 100% | 90% | 16% | 0.2% | - |
| Good (28 ms) | 54 | ~54 s | 100% | 100% | 86% | 29% | - |
| Expert (20 ms) | 81 | ~73 s | 100% | 100% | 100% | 98% | 22% |

Every skill level sees new sky, and orbit stays a rare, clip-worthy flex.

## Status

Written by Claude in a cloud container with **no Unreal Engine install**. This is what has been
verified without the engine:

- The material script **runs to completion** against a fake `unreal` module built from the real
  UE 5.5 Python API: every class, property, enum and function it uses exists. Re-running it
  correctly skips the rebuild.
- Engine API names in the C++ were cross-checked against the UE 5.5 API and open-source UE5
  plugins that use the same calls (Cesium, UnLua, UnrealImGui, RuntimeAudioImporter).
- All game code passes the mock compile check with zero warnings, and the engine-free code passes
  its unit tests.

What only a real build can confirm: the actual Unreal compile (a few small fixes are still
possible), the look (exposure, clouds, colours) and performance. Screenshots and any compiler
output from the first launch are the fastest way to finish it.
