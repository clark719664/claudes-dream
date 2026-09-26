# Reverie Browser Platform

## Product invariant

A generated game must become playable before any expensive AI asset finishes.
AI generation improves fidelity; it is never required for playback.

## Runtime path

1. Idea becomes a normalized Reverie game spec.
2. Browser builds the procedural world immediately.
3. Semantic asset requests identify only visually important source assets.
4. Browser asks the asset service for a semantic key.
5. Cache/CDN hit upgrades the placeholder immediately.
6. A miss may enqueue generation, but gameplay continues.
7. Generation workers compile outputs into ordinary web game assets.
8. Browser hot-swaps the optimized result when available.

## Asset compiler target

Generated source -> validation -> topology repair -> decimation -> LODs ->
UV/bake -> PBR maps -> collision -> KTX2 textures -> GLB mesh -> immutable CDN.

Never ship raw model output directly into a game.

## Generate less

Reverie should generate identity, not every instance. A forest should request a
small set of species/material source assets and create diversity with seeded
procedural deformation, material parameters, placement, weathering and LOD.

Priority:
- AI/generated: hero characters, creatures, architecture, weapons, signature props.
- Derived: tree/rock/building families, furniture, ruins, repeated props.
- Procedural: terrain microdetail, grass, pebbles, debris, puddles, snow, moss,
  particles and ordinary clutter.

## Free/open deployment

The platform contract is provider-neutral. A community deployment can use
self-hosted workers and object storage; a hosted deployment can attach donated,
sponsored or paid infrastructure without changing games or the browser runtime.
No generated game may depend on a proprietary generation provider to play.

## Storage discipline

Asset keys are semantic/content-derived. Server storage is deduplicated.
Browser storage is bounded and evicted least-recently-used. Published games
reference immutable optimized assets rather than retaining generation models.

## Quality

Low, medium, high and ultra tiers change texture/triangle/memory budgets while
preserving gameplay. Generation quality and playback quality are independent.

## Next milestones

- persistent manifest store + object storage/CDN adapter
- provider-neutral generation worker API
- GLB/KTX2 loader and hot-swap integration in the renderer
- richer semantic visual/material schema in game specs
- browser IndexedDB asset cache
- automatic hardware quality selection
- procedural material layering and expanded biome/scatter catalog
- skeletal/skinned character path and animation/IK
- publishing, immutable game manifests and remix lineage
- service worker/PWA and offline playback for already-cached games
