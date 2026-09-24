# SKYSTACK

**Stack to the sky. Don't miss.**

A one-tap tower stacker for Unreal Engine 5, built to be clipped, shared and replayed.
A block slides back and forth: tap to drop it. Whatever overhangs gets sliced off and tumbles
away under real physics. Land it dead-on for a **PERFECT**: the note climbs a musical scale,
confetti flies and streaks grow your tower back. Miss, and the whole tower comes down in
slow motion.

The entire game is code: **zero binary assets**. The graphics, animation, sound, music
and UI are all generated at runtime from ~2,800 lines of C++, so the repo stays tiny and
every part of it can be tweaked in a text editor.

---

## Why it can go viral

| Hook | What it does in the game |
|---|---|
| **Daily Challenge** | Everyone in the world gets the *same* tower each day (seeded colours, speeds, WOBBLE and RUSH floors). "Floor 37 on today's daily is evil" is a conversation. |
| **Wordle-style share code** | Press **C** on the game-over screen. A spoiler-free emoji grid goes to your clipboard: 🟩 perfect, 🟨 trimmed, 🟧 clutch, 💥 the fall. It's built for group chats and X/Threads. |
| **Clip-ready collapses** | Every run ends with the whole tower exploding apart in slow motion while the camera pulls back and orbits: a ready-made 5-second TikTok/Shorts ending. |
| **CLUTCH! moments** | Saving a drop with less than 30% of the block left triggers slow-mo, chromatic aberration and a big callout. These are the moments streamers yell at. |
| **Screenshot-bait game over card** | Big score, a rainbow NEW BEST!, a snarky taunt ("Touch grass. From orbit."), stats and the run grid. It reads well as a single phone screenshot. |
| **Visible rival: your record** | A gold frame hangs in the sky at your best height, so you always know exactly how far you are from beating it. |
| **Instant retry** | The retry key works mid-fall. There are no menus between runs, so "one more try" costs nothing. |
| **Progression you can see** | Every 20 floors the sky changes zone: Ground Floor, Cloud Line, Golden Hour, Dusk, Night Sky, Low Orbit, The Void. "I reached The Void" is a flex. |
| **Streaks** | Daily streak counter plus all-time stats on the title screen. |

## Features

- **Stacking core:** alternating X/Y slide axis, slice-off with physics debris, a perfect window that scales with speed, and streaks that regrow the tower.
- **Twists:** WOBBLE floors (the speed oscillates) and RUSH floors (1.35x speed) arrive with audio warnings.
- **Juice:** jelly squash on landing, a white halo burst on perfects, ballistic confetti, trauma-based screen shake, hit-stop slow motion, chromatic pulses and a score pop.
- **World:** a gradient-hue tower on an endless pillar rising out of fog, drifting low-poly clouds, and a two-light stylised look. The sky, sun angle and colour shift per zone.
- **Adaptive music:** a real-time synth plays an Am-F-C-G progression. Pads are always on; kick and bass come in when you start, drums at a 3-combo or floor 20, and an arpeggio at a 6-combo or floor 60. It ducks when you fall.
- **Procedural SFX:** thock, chop crunch, perfect bells that climb the A minor pentatonic scale, clutch whoosh, fall womp, collapse rumble, zone arpeggio and record fanfare.
- **UI:** animated rainbow title, mode cards, danger vignette when the tower gets thin, floating callouts, and a game-over card with an animated run grid.
- **Saves:** best endless score, today's daily best, daily streak, games played, total floors and mute setting.
- **Input:** keyboard, mouse, gamepad and touch (mobile-ready).

## Controls

| Action | Keyboard / Mouse | Gamepad | Touch |
|---|---|---|---|
| Drop / Start / Retry | Space, Enter, Left Click | A / Cross, Start | Tap |
| Instant restart | R | X / Square | - |
| Choose mode (title) | D, E, or arrow keys | D-pad | - |
| Copy share code | C | Y / Triangle | - |
| Menu / Quit | Tab, Esc | B / Circle | - |
| Mute | M | - | - |

> In the editor, **Esc** stops Play-In-Editor, so use **Tab** to get back to the menu.

## Build and run

**You need:** Unreal Engine **5.4 or newer**, and a C++ toolchain. On Windows that's Visual Studio 2022 with the *Game development with C++* workload; on Mac, Xcode.

1. Clone this repo.
2. Right-click `SkyStack.uproject` and choose **Generate Visual Studio project files**. On Mac, choose *Services, Generate Xcode Project*.
   - If you're on a different engine version, first use **Switch Unreal Engine version...** from the same menu.
3. Double-click `SkyStack.uproject` and say **Yes** when it asks to build the `SkyStack` module. Alternatively, open the `.sln` file and build the `SkyStack` *Development Editor* target.
4. Press **Play**. The project boots into the engine's empty `Entry` map, and the game builds its whole world at runtime.

**To ship it:** use *Platforms, Windows (or Android / iOS), Package Project*. The build pulls in only engine basic shapes and fonts, so packages stay small.

### Troubleshooting

- **Black or blown-out image:** exposure is fixed so the zone colours look as designed. Tweak `Settings.AutoExposureBias` in `ASkyStackDirector`'s constructor (+1 is brighter, -1 darker), or the light intensities in `GZones`.
- **Nothing happens when you press Play:** make sure *Project Settings, Maps & Modes, Default GameMode* is `SkyStackGameMode`. Alternatively, create any empty level and set its *World Settings, GameMode Override* to `SkyStackGameMode`.
- **Compile error:** this code was written against the UE 5.4+ API but **has not been compiled yet** (see below). Any error should be a small API-name fix. Paste it back to Claude and it'll patch it.

## Code map

```
Source/SkyStack/
  SkyStackDirector.*   The game: rules, camera, lights, fog, post FX, input, zones, share text
  SkyStackBlock.*      Every visible object (cube/sphere + dynamic material + tween/physics)
  SkySynth.*           Real-time synthesizer + step sequencer (USoundWaveProcedural)
  SkyStackHUD.*        All UI, drawn on the canvas
  SkyStackSave.h       Persistent stats
  SkyStackGameMode.*   Wires up the pawn and HUD
Config/                Boot map, renderer settings (Lumen off for low-end reach), legacy input
```

### Tuning knobs

All in the `SkyStackTuning` namespace at the top of `SkyStackDirector.cpp`:

| Constant | Controls |
|---|---|
| `BaseSpeed` / `SpeedPerFloor` / `MaxSpeed` | Difficulty curve |
| `PerfectTolerance` / `PerfectWindowSeconds` | How forgiving perfects are |
| `ComboToGrow` / `GrowAmount` | Streak reward |
| `ClutchRatio` | What counts as a clutch |
| `FloorsPerZone` | How often the sky changes |
| `GZones` | Zone names, sky colours, sun colour, intensity and angle |

## Launch playbook

1. **Record the collapse.** End every short-form clip on the slow-mo tower fall. Put the score in the first frame, e.g. "Floor 87. Then THIS happened."
2. **Seed the daily.** Post your own daily share grid every day with the daily number. Others will reply with theirs.
3. **Streamer bait.** CLUTCH! plus the danger vignette plus the adaptive music build-up makes for readable, loud moments. Send keys to small streamers who play "one more try" games.
4. **Go mobile.** One-tap and portrait-safe UI make this a natural fit for Android and iOS. Most viral hyper-casual growth happens on phones.

## Status

Written in one shot by Claude in a cloud container **without an Unreal Engine install**, so it
has **not been compiled or play-tested yet**. The design, code paths and API usage were
checked carefully, but expect possibly a couple of small compile fixes and some visual tuning
(exposure, colours, speeds) on first launch.
