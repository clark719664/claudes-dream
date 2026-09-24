# Reverie

**Describe a game. Play it in seconds.**

Reverie is a WebGPU game engine for the browser with a physically based, GPU-driven renderer and an AI game designer. Type an idea such as *"a cozy forest at golden hour where you collect glowing mushrooms while avoiding sneaky slimes"*. Claude designs the world, rules, look and music as a small JSON game spec, and the engine turns it into a playable 3D game on phones and PCs, with nothing to install and no asset downloads.

## Quick start

```bash
npm install
npm start                     # http://localhost:5173
```

That runs the **Studio** with the built-in offline designer. To design games with Claude, provide an API key:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Optional settings: `REVERIE_MODEL` (default `claude-opus-5`), `REVERIE_EFFORT` (`low` · `medium` · `high`, default `medium`), `PORT`.

Reverie needs a browser with WebGPU: current Chrome, Edge and Safari, and recent Firefox on Windows, on both desktop and mobile. There is no build step. The engine is plain ES modules, so the `studio/`, `play/`, `engine/` and `shared/` folders also work from any static host. When no server is present, the offline designer runs in the browser.

## What you can do

- **Generate** a game from a sentence, or pick one of the idea chips.
- **Refine** it in plain language: *"make it night"*, *"add more enemies"*, *"turn it into a snowy winter wonderland"*, *"first person"*.
- **Tweak** time of day, clouds, fog, wind, weather, sky tint and the camera look (glow, exposure, saturation, contrast, warmth, vignette) with live sliders. Recolour objects, or edit the JSON directly.
- **Play**: WASD or the arrow keys to move, Space to jump, Shift to sprint, the mouse to look, and P to pause. On touch screens you get an on-screen stick plus jump and sprint buttons. Gamepads work too.
- **Share** a link that contains the whole game (a few KB, compressed into the URL). Anyone can open it in `play/`.
- **Undo / redo**, export and import game files. Your last game is restored when you come back.

Example games live in [`examples/`](examples/) and open with `play/?example=golden-grove`.

## Rendering

All techniques run in real time in WebGPU (WGSL shaders, compute passes and indirect draws):

- **Physically based sky and atmosphere** (Hillaire 2020): transmittance, multi-scattering and sky-view lookup tables computed on the GPU. Sunrises, sunsets, moonlit nights and alien skies all come out of the same model.
- **Image-based lighting from the live sky**: an environment cube, spherical-harmonic irradiance and GGX-prefiltered reflections, refreshed as the sun and clouds move.
- **Volumetric fog and aerial perspective** in a camera-aligned 3D grid, lit through the shadow maps. This produces light shafts through trees and glowing halos around lights.
- **Cascaded soft shadows**: stable, texel-snapped cascades with rotated Poisson filtering, including shadows from alpha-tested foliage and moving cloud shadows.
- **PBR materials**: GGX specular, height-correlated Smith visibility, multi-scatter energy compensation and horizon occlusion.
- **Ground-truth ambient occlusion (GTAO)** with a depth prepass.
- **GPU-driven instancing**: compute-shader frustum culling and LOD selection for every object and every shadow cascade, with one indirect draw per batch.
- **Terrain** displaced from a heightmap on the GPU, with LOD chunks and a procedural material that blends by slope and altitude, with micro-relief and wet shorelines.
- **Vegetation**: trees built from leaf cards (procedurally painted atlas, light passing through the leaves, layered wind), and hundreds of thousands of GPU-generated grass blades that bend in gusts and part around the player.
- **Water**: refraction, depth absorption, screen-space reflections, sun glints and foam. Hot colours turn it into lava.
- **GPU particles**: snow, rain streaks, fireflies, embers, dust and spores, plus gameplay bursts.
- **Cinematic post-processing**: temporal anti-aliasing with upscaling, histogram auto-exposure, physically based bloom, AgX tonemapping, colour grading, adaptive sharpening and a night-vision colour shift.

### Performance on phones and PCs

- **Quality tiers** (low, medium, high, ultra) are picked automatically from the device and can be overridden in the Studio.
- **Dynamic resolution**: the scene renders below screen resolution when needed to hold the frame budget, and temporal upscaling reconstructs the full image.
- The GPU does the culling, so the CPU work per frame stays flat no matter how many objects exist.
- The title screen runs at 30 fps and the game pauses when the tab is hidden.
- **No asset files**: meshes, textures, terrain, sound and music are all generated from code.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the frame breakdown and tier table.

## The AI designer

- [`server/claude.js`](server/claude.js) calls Claude with **structured outputs**, so every response is a spec that matches [`GAME_SPEC_SCHEMA`](shared/spec.js). It uses **adaptive thinking**, and the thinking summaries stream into the Studio so you can watch the design take shape. The system prompt describes the engine's capabilities, coordinate system and level-design rules (reachable jumps, readable hazards, budgets), and it is cached. Server-side refusal fallbacks are switched on.
- **Refinements** send the current spec plus your request, and the reply is the full updated game.
- [`normalizeSpec()`](shared/spec.js) clamps every value, drops broken references, repairs unwinnable rules and enforces the entity budget. Whatever the AI returns loads safely and stays fast.
- The **offline designer** ([`shared/designer.js`](shared/designer.js)) takes over when there is no key, the network is down, or the page is hosted statically.

The full spec format is documented in [docs/GAME_SPEC.md](docs/GAME_SPEC.md).

## Project layout

```
engine/           the runtime (ES modules, no build step)
  render/         WebGPU renderer: atmosphere, shadows, scene, grass, water, particles, volumetrics, GTAO, post
  game/           world builder, physics, player, camera, behaviours, rules
  core/           math, input, audio
  gpu/            device setup, quality tiers, resource helpers
  world/          heightfield generation
  ui/             in-game HUD
shared/           game spec + schema, offline designer, share links, seeded RNG and noise
server/           dev server and Claude integration
studio/           the Studio web app
play/             standalone player (share links, examples)
examples/         curated example games
tests/            node:test suites
tools/            headless WebGPU screenshot and play-test harnesses, docs generator
```

## Testing

```bash
npm test                                              # spec, designer, terrain, physics, share links, server + mock Claude API
node tools/shot.mjs "tools/testbed.html?time=18.7" out.png 8     # render the testbed in headless WebGPU
node tools/playtest.mjs "example=golden-grove" test-output/pt    # scripted play-through with screenshots
node tools/studio-shot.mjs test-output/studio.png                # generate a game in the Studio and screenshot it
```

The headless tools run Chromium with SwiftShader's software WebGPU, so they check correctness, not real-world speed.

## Limitations

- WebGPU is required. There is no WebGL fallback yet, so older browsers show a message instead of the game.
- Everything is procedural. Characters are stylised primitives, and there is no skeletal animation or imported-model pipeline yet.
- Moving objects are handled by TAA through neighbourhood clamping, without per-object motion vectors, so fast-moving objects can ghost slightly.
- Clouds are a lit procedural layer, not raymarched volumetric clouds.
- Gameplay covers the 13 built-in behaviours and 4 rule sets. There is no scripting API yet.
