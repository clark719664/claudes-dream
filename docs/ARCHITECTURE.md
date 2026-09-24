# Architecture

Reverie is three layers that talk through one JSON document, the **game spec**:

```
 idea ──► AI designer ──► game spec ──► world builder ──► engine runtime ──► WebGPU renderer
          (Claude or      (shared/      (engine/game/     (engine/engine.js,  (engine/render/*)
           offline)        spec.js)      builder.js)       game/*, core/*)
```

The spec is validated by `normalizeSpec()` before anything else sees it, so the engine never has to defend against malformed or over-budget input.

## Renderer

`engine/render/renderer.js` owns the frame. Everything is WebGPU (WGSL shaders, compute passes, indirect draws). One frame:

| # | Pass | What happens | Tier notes |
| - | ---- | ------------ | ---------- |
| 1 | Atmosphere | Sky-view LUT every frame; transmittance and multi-scattering LUTs when the atmosphere changes; environment cube, SH irradiance and GGX-prefiltered mips when the sun or clouds move (Hillaire 2020). | Env cube 32² (low) to 128² (ultra) |
| 2 | Culling | A compute shader tests every instance against the camera and each shadow cascade (frustum + distance LOD bands) and writes compact visible lists and `drawIndexedIndirect` arguments. | CPU cost is one indirect draw per batch per view, regardless of instance count |
| 3 | Shadows | Cascaded shadow maps, bounding-sphere fitted and texel-snapped for stability; alpha-tested foliage casts correct shadows. | 2 × 1024² (low) to 4 × 4096² (ultra) |
| 4 | Volumetrics | Froxel grid: in-scattering and extinction from the scaled physical atmosphere (aerial perspective) plus height fog lit by the sun through the cascades (light shafts), the sky, and point lights; then front-to-back integration. | 64×36×32 without shadows (low) to 192×108×96 (ultra) |
| 5 | Prepass + GTAO | Depth prepass, then ground-truth ambient occlusion at half resolution with temporally rotated slices and a bilateral blur. | high/ultra |
| 6 | Main | Forward PBR (GGX, height-correlated Smith, multi-scatter energy compensation, split-sum IBL), procedural terrain material, alpha-tested leaf cards with translucency, rock detail shading, GPU grass, physically based sky, sun/moon discs, stars and the cloud layer. | Grass radius 24 m (low) to 75 m (ultra) |
| 7 | Water | Refraction of a scene copy, Beer–Lambert absorption, screen-space reflections with sky fallback, sun glints, shoreline foam; or lava. | |
| 8 | Particles | Compute-simulated weather pool recycled around the camera plus gameplay bursts; soft, depth-faded billboards. | 4k (low) to 49k (ultra) |
| 9 | Post | TAA with upscaling (jittered projection, reprojection, variance clipping, Catmull-Rom history), dual-filter bloom, histogram auto exposure, AgX tonemapping, grading, contrast-adaptive sharpening, grain. | |

### Resolution strategy

The scene renders at an **internal resolution** that adapts every second to the tier's frame budget (`#adaptResolution`). The TAA pass reconstructs the full **output resolution** from successive jittered frames, and the composite pass sharpens the result. Phones render at 50–75 % scale, desktops at 67–100 %.

### Quality tiers

`engine/gpu/gpu.js` picks a tier from the device class (mobile user agent, integrated vs. discrete GPU, software adapter). Players can override it in the Studio.

| Setting | low | medium | high | ultra |
| --- | --- | --- | --- | --- |
| Internal scale | 0.5–0.75 | 0.6–0.85 | 0.67–1.0 | 0.8–1.0 |
| Max output | 720p | 1080p | 1440p | 4K |
| Shadow cascades | 2 × 1024 | 3 × 2048 | 4 × 2048 | 4 × 4096 |
| Volumetric shadows | – | ✓ | ✓ | ✓ |
| GTAO | – | – | ✓ | ✓ |
| Grass radius / density | 24 m / 5 | 38 m / 8 | 55 m / 11 | 75 m / 15 |
| Particles | 4k | 12k | 24k | 49k |

### GPU-driven instancing

`engine/render/scene.js`: every prop, tree, entity and terrain chunk is a 128-byte record (model matrix, material, flags, bounding sphere) in one storage buffer. Batches group instances by mesh and carry a `[minDist, maxDist)` band, so level-of-detail selection is just the same instance living in several batches; the cull shader keeps exactly one. Terrain chunks are flat grids displaced from the heightmap in the vertex shader, with skirts to hide LOD seams.

### Assets

There are no asset files. Meshes (`meshes.js`) are built from code, the foliage texture atlas (`foliageAtlas.js`) is painted with Canvas 2D at startup, terrain and vegetation placement come from seeded noise, and audio (`core/audio.js`) is synthesised. A complete game is typically 2–6 KB of JSON and fits in a share link.

## Gameplay

- `game/builder.js` builds the heightfield, GPU scene, physics colliders and entity list from a spec.
- `game/physics.js` is a kinematic character controller: heightfield ground, static boxes in a spatial hash, moving platforms that carry the player, step-up, slope sliding and swimming.
- `game/player.js` handles movement feel: acceleration curves, coyote time, jump buffering, variable jump height, squash and stretch.
- `game/behaviors.js` implements the thirteen spec behaviours (spin, bob, collectible, hazard, goal, checkpoint, bounce, patrol, chase, orbit, light, shooter, heal).
- `game/game.js` runs the rules (collect, reach, survive, score), timers, lives, projectiles and all feedback (particles, sound, flashes, camera shake).
- `core/input.js` merges keyboard/mouse, touch (virtual stick, look-drag, buttons) and gamepads.

## AI designer

`server/claude.js` asks Claude for a complete spec using **structured outputs** (`output_config.format` with `GAME_SPEC_SCHEMA`), **adaptive thinking** with summarized thoughts streamed to the Studio, a **cached system prompt** describing the engine's capabilities and design rules, and **server-side refusal fallbacks**. Refinements send the current spec plus the change request and get a full updated spec back. `normalizeSpec()` then enforces ranges and budgets.

Without credentials, or if the API call fails, `shared/designer.js` designs the game offline: it reads themes, genres, time of day, difficulty, object names and colours from the prompt and assembles a spec from tuned building blocks. The same module handles plain-language refinements ("make it night", "more enemies").
