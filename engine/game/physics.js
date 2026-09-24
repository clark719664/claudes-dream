// Lightweight game physics: a kinematic character controller that collides
// with the heightfield, static boxes (via a spatial hash) and moving
// platforms, with step-up, slope sliding, ceilings and swimming.

const CELL = 8;

export class Physics {
  constructor(heightfield, { waterLevel = null, lava = false } = {}) {
    this.hf = heightfield;
    this.waterLevel = waterLevel;
    this.lava = lava;
    this.grid = new Map();
    this.dynamic = [];
    this.gravity = 26;
    this.bounds = heightfield.playSize / 2 - 1.5;
    this.tmpN = [0, 1, 0];
  }

  #key(i, j) { return `${i},${j}`; }

  /** Static collider: { min: [x,y,z], max: [x,y,z], entity? } */
  addStatic(box) {
    const i0 = Math.floor(box.min[0] / CELL), i1 = Math.floor(box.max[0] / CELL);
    const j0 = Math.floor(box.min[2] / CELL), j1 = Math.floor(box.max[2] / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.#key(i, j);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(box);
    }
    return box;
  }

  /** Moving solid whose box is refreshed by its owner every frame. */
  addDynamic(box) { this.dynamic.push(box); return box; }

  groundAt(x, z) { return this.hf.heightAt(x, z); }

  /** Height of the walkable/swimmable surface: max(ground, water). */
  surfaceAt(x, z) {
    const g = this.hf.heightAt(x, z);
    return this.waterLevel !== null ? Math.max(g, this.waterLevel) : g;
  }

  #nearby(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const seen = new Set();
    for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) {
      for (let j = Math.floor(minZ / CELL); j <= Math.floor(maxZ / CELL); j++) {
        const list = this.grid.get(this.#key(i, j));
        if (!list) continue;
        for (const b of list) if (!seen.has(b)) { seen.add(b); out.push(b); }
      }
    }
    for (const b of this.dynamic) if (b.active !== false) out.push(b);
    return out;
  }

  /**
   * Move a character { pos, vel, radius, height } by its velocity.
   * Sets: grounded, ground (entity or 'terrain'), inWater, hitHead.
   */
  moveCharacter(c, dt) {
    const boxes = this.#nearby(c.pos[0] - 3, c.pos[2] - 3, c.pos[0] + 3, c.pos[2] + 3, c._near ?? (c._near = []));
    const r = c.radius, h = c.height;
    const overlaps = (b, x, y, z) => x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2] && y + h > b.min[1] && y < b.max[1];
    c.grounded = false;
    c.ground = null;
    c.hitHead = false;

    // carried by a moving platform
    if (c.carrier && c.carrier.delta) {
      c.pos[0] += c.carrier.delta[0];
      c.pos[1] += c.carrier.delta[1];
      c.pos[2] += c.carrier.delta[2];
    }

    // horizontal axes with step-up
    for (const axis of [0, 2]) {
      const move = c.vel[axis] * dt;
      if (!move) continue;
      c.pos[axis] += move;
      for (const b of boxes) {
        if (!overlaps(b, c.pos[0], c.pos[1], c.pos[2])) continue;
        const step = b.max[1] - c.pos[1];
        if (step > 0 && step < 0.45 && !boxes.some((o) => o !== b && overlaps(o, c.pos[0], b.max[1] + 0.01, c.pos[2]))) {
          c.pos[1] = b.max[1] + 0.001;
          continue;
        }
        c.pos[axis] = move > 0 ? b.min[axis] - r - 1e-4 : b.max[axis] + r + 1e-4;
        c.vel[axis] = 0;
      }
    }

    // vertical
    c.pos[1] += c.vel[1] * dt;
    for (const b of boxes) {
      if (!overlaps(b, c.pos[0], c.pos[1], c.pos[2])) continue;
      if (c.vel[1] <= 0 && c.pos[1] - c.vel[1] * dt >= b.max[1] - 0.05) {
        c.pos[1] = b.max[1];
        c.vel[1] = 0;
        c.grounded = true;
        c.ground = b.entity ?? b;
      } else if (c.vel[1] > 0) {
        c.pos[1] = b.min[1] - h - 1e-4;
        c.vel[1] = 0;
        c.hitHead = true;
      } else {
        c.pos[1] = b.max[1];
        c.grounded = true;
        c.ground = b.entity ?? b;
      }
    }

    // terrain
    const g = this.hf.heightAt(c.pos[0], c.pos[2]);
    if (c.pos[1] <= g) {
      c.pos[1] = g;
      if (c.vel[1] < 0) c.vel[1] = 0;
      c.grounded = true;
      c.ground = 'terrain';
      const n = this.hf.normalAt(c.pos[0], c.pos[2], this.tmpN);
      if (n[1] < 0.62) {
        // too steep: slide down the slope
        c.vel[0] += n[0] * this.gravity * dt * 1.4;
        c.vel[2] += n[2] * this.gravity * dt * 1.4;
        c.sliding = true;
      } else c.sliding = false;
    }

    // water
    c.inWater = false;
    if (this.waterLevel !== null && c.pos[1] < this.waterLevel - 0.9 && !this.lava) {
      c.inWater = true;
    }
    c.inLava = this.lava && this.waterLevel !== null && c.pos[1] < this.waterLevel - 0.2;

    // soft world bounds
    for (const axis of [0, 2]) {
      if (c.pos[axis] > this.bounds) { c.pos[axis] = this.bounds; c.vel[axis] = Math.min(c.vel[axis], 0); }
      if (c.pos[axis] < -this.bounds) { c.pos[axis] = -this.bounds; c.vel[axis] = Math.max(c.vel[axis], 0); }
    }
    c.carrier = c.ground && c.ground !== 'terrain' && c.ground.delta ? c.ground : null;
    return c;
  }

  /** Raycast-free line of sight approximation against the terrain. */
  terrainBlocks(a, b, samples = 8) {
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      if (this.hf.heightAt(x, z) > y) return true;
    }
    return false;
  }
}
