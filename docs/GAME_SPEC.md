# Game spec reference

A Reverie game is one JSON document. The AI designer (Claude or the offline designer) writes it, the Studio edits it, and the engine turns it into a playable world. Everything is validated by `normalizeSpec()` in [`shared/spec.js`](../shared/spec.js): out-of-range numbers are clamped, unknown references dropped, unwinnable rules repaired and the performance budget enforced, so any input is safe to load.

> This file is generated from `GAME_SPEC_SCHEMA` by `node tools/gen-spec-docs.mjs`.

## Budget

| Limit | Value |
| --- | --- |
| prefabs | 32 |
| placements | 400 |
| spawns | 32 |
| spawnCount | 200 |
| entities | 900 |
| scatter | 8 |
| behaviorsPerPrefab | 5 |

## Fields

### `spec`

A complete Reverie game.

| Field | Type | Description |
| --- | --- | --- |
| `title` | string | Short evocative game title (max 40 chars). |
| `tagline` | string | One-sentence pitch shown on the title card (max 120 chars). |
| `seed` | integer | Random seed for procedural generation (any positive integer). |
| `environment` | object | Sky, lighting and atmosphere. |
| `terrain` | object | Procedural landscape. The playable area is centred on the origin. |
| `water` | object | Global water plane. |
| `scatter` | array of objects | Procedural decoration spread over the terrain (max 8 entries). |
| `player` | object | The player character. |
| `prefabs` | array of objects | Reusable object templates (max 32). |
| `placements` | array of objects | Hand-placed instances (max 400). |
| `spawns` | array of objects | Procedural groups of instances (max 32). |
| `rules` | object | Win/lose logic. |
| `post` | object | Cinematic post-processing / color grading. |
| `audio` | object | Procedural soundtrack. |

#### `environment`

Sky, lighting and atmosphere.

| Field | Type | Description |
| --- | --- | --- |
| `environment.timeOfDay` | number | Hour 0-24. 6.5 dawn, 13 noon, 18.7 golden sunset, 23 night. |
| `environment.sunAzimuth` | number | Compass direction of the sun in degrees 0-360. |
| `environment.cloudCover` | number | 0 clear sky to 1 fully overcast. |
| `environment.fogDensity` | number | 0 crystal clear to 1 very thick fog. |
| `environment.fogColor` | string | Fog tint. Use "auto" to derive from the sky. Hex color, e.g. "#ffaa33". |
| `environment.skyTint` | string | Multiplies the sky. "#ffffff" is a natural Earth sky; purple/green for alien worlds. Hex color, e.g. "#ffaa33". |
| `environment.particles` | `none` \| `fireflies` \| `snow` \| `embers` \| `dust` \| `rain` \| `spores` | Ambient particle effect filling the air. |
| `environment.wind` | number | 0 still to 1 stormy; sways foliage, grass, water and particles. |

#### `terrain`

Procedural landscape. The playable area is centred on the origin.

| Field | Type | Description |
| --- | --- | --- |
| `terrain.style` | `hills` \| `mountains` \| `islands` \| `canyon` \| `dunes` \| `flat` \| `terraces` | Landform generator. |
| `terrain.size` | number | Playable width in meters, 60-400. 140 is a good default. |
| `terrain.height` | number | Vertical relief in meters, 0-60. |
| `terrain.roughness` | number | 0 smooth to 1 rugged. |
| `terrain.palette` | object | Ground colors by altitude/slope. |

#### `terrain.palette`

Ground colors by altitude/slope.

| Field | Type | Description |
| --- | --- | --- |
| `terrain.palette.low` | string | Lowlands / beaches. Hex color, e.g. "#ffaa33". |
| `terrain.palette.mid` | string | Main ground cover (grass grows here). Hex color, e.g. "#ffaa33". |
| `terrain.palette.high` | string | Peaks. Hex color, e.g. "#ffaa33". |
| `terrain.palette.cliff` | string | Steep slopes. Hex color, e.g. "#ffaa33". |

#### `water`

Global water plane.

| Field | Type | Description |
| --- | --- | --- |
| `water.enabled` | boolean | Whether there is water. |
| `water.level` | number | Water height in meters relative to the lowest terrain (0-30). |
| `water.color` | string | Deep water color. Bright orange/red makes lava. Hex color, e.g. "#ffaa33". |

#### `scatter[]`

A decoration layer.

| Field | Type | Description |
| --- | --- | --- |
| `scatter[].kind` | `pine` \| `oak` \| `palm` \| `rock` \| `grass` \| `crystal` \| `cactus` \| `mushroom` \| `pillar` \| `flower` | What to scatter. grass is a dense field of blades. |
| `scatter[].density` | number | 0-1. 0.3 is moderate, 1 is dense. |
| `scatter[].color` | string | Main tint (leaves, grass, rock, crystal...). Hex color, e.g. "#ffaa33". |
| `scatter[].scale` | number | Size multiplier 0.3-3. |

#### `player`

The player character.

| Field | Type | Description |
| --- | --- | --- |
| `player.color` | string | Avatar color. Hex color, e.g. "#ffaa33". |
| `player.speed` | number | Run speed m/s, 3-20. 7 is normal. |
| `player.jump` | number | Jump height in meters, 0.5-12. 2.2 is normal. |
| `player.camera` | `third` \| `first` | third = over-the-shoulder, first = eyes view. |
| `player.lives` | integer | Lives / hit points, 1-9. |
| `player.spawn` | array of number | [x, heightAboveGround, z] start position. Exactly 3 numbers. |

#### `prefabs[]`

A template.

| Field | Type | Description |
| --- | --- | --- |
| `prefabs[].id` | string | Unique identifier, lowercase letters/digits/underscores, e.g. "gold_coin". |
| `prefabs[].shape` | `box` \| `sphere` \| `cylinder` \| `cone` \| `torus` \| `capsule` \| `gem` \| `coin` \| `star` \| `pyramid` \| `crystal` | Visual primitive. |
| `prefabs[].color` | string | Base color. Hex color, e.g. "#ffaa33". |
| `prefabs[].emissive` | number | Glow strength 0-8. 0 is not glowing; 2-4 glows with bloom. |
| `prefabs[].metallic` | number | 0 dielectric to 1 metal. |
| `prefabs[].roughness` | number | 0 mirror to 1 matte. |
| `prefabs[].size` | array of number | [width, height, depth] in meters. Exactly 3 numbers. |
| `prefabs[].solid` | boolean | true if the player collides with it and can stand on it (platforms, walls). |
| `prefabs[].behaviors` | array of objects | Logic attached to the object (max 5). |

#### `prefabs[].behaviors[]`

A behaviour. Unused numeric fields should be 0.

| Field | Type | Description |
| --- | --- | --- |
| `prefabs[].behaviors[].type` | `spin` \| `bob` \| `collectible` \| `hazard` \| `goal` \| `checkpoint` \| `bounce` \| `patrol` \| `chase` \| `orbit` \| `light` \| `shooter` \| `heal` | spin: rotates (speed=deg/s). bob: floats (range=amplitude, speed=cycles/s). collectible: picked up (value=points). hazard: hurts player (value=damage). goal: touching wins. checkpoint: respawn point. bounce: launches player (value=launch speed). patrol: moves back and forth (range=distance, speed=m/s, axis). chase: follows player (speed, range=detection radius). orbit: circles its spawn point (range=radius, speed=rad/s). light: emits light (value=intensity, range=radius). shooter: fires orbs at player (value=seconds between shots, speed=orb speed, range=detection). heal: restores a life (value=lives). |
| `prefabs[].behaviors[].value` | number | Primary parameter (see type). |
| `prefabs[].behaviors[].speed` | number | Speed parameter (see type). |
| `prefabs[].behaviors[].range` | number | Distance/radius parameter (see type). |
| `prefabs[].behaviors[].axis` | `x` \| `y` \| `z` | Axis for patrol; otherwise "y". |

#### `placements[]`

One instance.

| Field | Type | Description |
| --- | --- | --- |
| `placements[].prefab` | string | Prefab id. |
| `placements[].position` | array of number | [x, heightAboveGround, z]. y is the height of the object's base above the terrain (or water) surface at (x, z); 0 = standing on the ground. Exactly 3 numbers. |
| `placements[].rotationY` | number | Yaw in degrees. |
| `placements[].scale` | number | Uniform scale multiplier, 0.1-10. |

#### `spawns[]`

A spawn group.

| Field | Type | Description |
| --- | --- | --- |
| `spawns[].prefab` | string | Prefab id. |
| `spawns[].count` | integer | How many (1-200). |
| `spawns[].pattern` | `scatter` \| `ring` \| `path` \| `cluster` \| `line` \| `grid` | scatter: random in radius. ring: circle. path: winding trail from player spawn to center. cluster: tight clumps. line: straight row from player spawn to center. grid: square grid. |
| `spawns[].center` | array of number | [x, heightAboveGround, z] center of the group; y is the base height above the surface (0 = on the ground). Exactly 3 numbers. |
| `spawns[].radius` | number | Radius / half-extent in meters. |
| `spawns[].height` | number | Extra random height variation in meters (0 = all at center height). |

#### `rules`

Win/lose logic.

| Field | Type | Description |
| --- | --- | --- |
| `rules.goal` | `collect` \| `reach` \| `survive` \| `score` | collect: reach targetScore by collecting. reach: touch a goal object. survive: stay alive until timeLimit. score: highest score before timeLimit ends. |
| `rules.targetScore` | integer | Points needed for collect (0 = collect everything). |
| `rules.timeLimit` | number | Seconds; 0 = no limit. Required for survive/score. |
| `rules.objective` | string | Short instruction shown in the HUD. |
| `rules.winMessage` | string | Shown on victory. |
| `rules.loseMessage` | string | Shown on defeat. |

#### `post`

Cinematic post-processing / color grading.

| Field | Type | Description |
| --- | --- | --- |
| `post.bloom` | number | 0-2, glow around bright things. 0.6 default. |
| `post.exposure` | number | Exposure compensation in stops, -2 to 2. 0 default. |
| `post.saturation` | number | 0-2. 1 default. |
| `post.contrast` | number | 0.5-1.5. 1 default. |
| `post.vignette` | number | 0-1. |
| `post.warmth` | number | -1 cool/blue to 1 warm/orange. |

#### `audio`

Procedural soundtrack.

| Field | Type | Description |
| --- | --- | --- |
| `audio.music` | `none` \| `calm` \| `upbeat` \| `tense` \| `mystic` | Generative music mood. |
| `audio.tempo` | number | Beats per minute 50-180. |

## Minimal example

```json
{
  "title": "Coin Meadow",
  "prefabs": [
    {
      "id": "coin",
      "shape": "coin",
      "color": "#ffc526",
      "emissive": 1,
      "metallic": 1,
      "roughness": 0.25,
      "size": [
        1,
        1,
        0.2
      ],
      "solid": false,
      "behaviors": [
        {
          "type": "collectible",
          "value": 10,
          "speed": 0,
          "range": 0,
          "axis": "y"
        },
        {
          "type": "spin",
          "value": 0,
          "speed": 120,
          "range": 0,
          "axis": "y"
        }
      ]
    }
  ],
  "spawns": [
    {
      "prefab": "coin",
      "count": 20,
      "pattern": "path",
      "center": [
        40,
        0.8,
        30
      ],
      "radius": 2,
      "height": 0
    }
  ],
  "rules": {
    "goal": "collect"
  }
}
```

Everything omitted takes a sensible default.
