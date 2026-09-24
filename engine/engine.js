// Reverie Engine: the public entry point.
//
//   const engine = await Engine.create(containerElement, { tier: 'auto' });
//   engine.load(spec);   // any object; it is normalized first
//   engine.start();      // begins rendering the title screen
//   engine.play();       // starts the game (usually from the Play button)
//
// Everything a game needs is generated from the spec: terrain, vegetation,
// sky, lighting, water, weather, entities, sound and music.

import { Renderer } from './render/renderer.js';
import { Volumetrics } from './render/volumetrics.js';
import { GTAO } from './render/gtao.js';
import { Grass } from './render/grass.js';
import { Water } from './render/water.js';
import { Particles } from './render/particles.js';
import { Clouds } from './render/clouds.js';
import { GI } from './render/gi.js';
import { Interaction } from './render/interaction.js';
import { buildWorld, isLava, skyForWeather } from './game/builder.js';
import { Weather } from './game/weather.js';
import { Game } from './game/game.js';
import { CameraRig } from './game/camera.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { HUD } from './ui/hud.js';
import { Conversations } from './ai/conversations.js';
import { designNextLevel } from './ai/director.js';
import { normalizeSpec } from '../shared/spec.js';
import { hexToLinear, mat4 } from './core/math.js';

export class Engine {
  static async create(container, options = {}) {
    const canvas = options.canvas ?? document.createElement('canvas');
    canvas.className = 'rv-canvas';
    canvas.tabIndex = 0;
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', outline: 'none', touchAction: 'none' });
    if (!canvas.parentElement) container.appendChild(canvas);
    const tier = options.tier && options.tier !== 'auto' ? options.tier : undefined;
    const renderer = await Renderer.create(canvas, { ...options, tier });
    return new Engine(container, canvas, renderer, options);
  }

  constructor(container, canvas, renderer, options) {
    this.container = container;
    this.canvas = canvas;
    this.renderer = renderer;
    this.options = options;
    this.listeners = new Map();
    this.running = false;
    this.menuFps = options.menuFps ?? 30;

    if (renderer.tier.clouds) {
      this.clouds = new Clouds(renderer);
      renderer.addFeature(this.clouds);
    }
    this.gi = new GI(renderer);
    renderer.addFeature(this.gi);
    this.interaction = new Interaction(renderer);
    renderer.addFeature(this.interaction);
    this.volumetrics = new Volumetrics(renderer);
    renderer.addFeature(this.volumetrics);
    if (renderer.tier.gtao) renderer.addFeature(new GTAO(renderer));
    this.grass = new Grass(renderer);
    renderer.addFeature(this.grass);
    this.water = new Water(renderer);
    renderer.addFeature(this.water);
    this.particles = new Particles(renderer);
    renderer.addFeature(this.particles);

    this.hud = new HUD(container);
    this.input = new Input(canvas);
    this.input.attachTouchControls(this.hud.root);
    this.audio = new Audio();
    this.camera = new CameraRig();
    this.weather = new Weather();
    this.hud.onPlay = () => this.play();
    this.hud.onNext = () => this.nextLevel();
    this.level = 1;
    this.conversations = new Conversations(this, { endpoint: options.npcEndpoint ?? '/api/npc' });
    this.on('talk', ({ open }) => {
      // talking unlocks the mouse without pausing; leaving hands control back
      this.suppressPause = open;
      if (!open && this.game?.state === 'playing') this.input.requestPointerLock();
    });

    canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (this.game?.state === 'playing' && !this.input.captured) this.input.requestPointerLock();
      if (this.game?.state === 'paused') this.resume();
    });
    this.onLockChange = () => {
      if (!this.input.captured && this.game?.state === 'playing' && this.input.pointerLockAllowed && !this.suppressPause) this.pause();
    };
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.onVisibility = () => { if (document.hidden && this.game?.state === 'playing') this.pause(); };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onKey = (e) => {
      if (!this.game) return;
      if (e.code === 'Escape' && this.conversations.isOpen) { this.conversations.close(); return; }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target?.isContentEditable) return;
      if (e.code === 'KeyP') this.game.state === 'paused' ? this.resume() : this.pause();
      if (e.code === 'Enter' && (this.game.state === 'attract' || this.game.state === 'won' || this.game.state === 'lost')) this.play();
    };
    window.addEventListener('keydown', this.onKey);
  }

  get tier() { return this.renderer.tierName; }
  get stats() { return { ...this.renderer.stats, grass: this.grass.stats?.blades ?? 0 }; }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }
  emit(type, data) { for (const fn of this.listeners.get(type) ?? []) fn(data); }

  /** Load a game spec (normalized first). Returns { spec, warnings }. */
  load(input) {
    const { spec, warnings } = normalizeSpec(input);
    this.game?.stop?.();
    this.conversations?.reset();
    this.timeTween = null;
    this.renderer.flash = [0, 0, 0, 0];
    const old = this.world?.scene;
    this.world = buildWorld(this.renderer, spec, { tier: this.renderer.tierName });
    old?.destroy();
    this.spec = spec;
    this.#configureFeatures(spec);
    this.audio.setMusic(spec.audio.music, spec.audio.tempo);
    this.camera.mode = 'orbit';
    this.game = new Game(this.world, {
      audio: this.audio, particles: this.particles, renderer: this.renderer, camera: this.camera,
      emit: (type, data) => this.#onGameEvent(type, data),
    });
    this.hud.titleCard(spec);
    this.emit('load', { spec, warnings });
    return { spec, warnings };
  }

  #configureFeatures(spec) {
    const w = this.world;
    const lava = w.lava;
    this.water.configure({
      enabled: spec.water.enabled, level: w.waterLevel ?? 0, color: hexToLinear(spec.water.color), lava,
      span: 3000, // reach the horizon so oceans never end in a visible edge
    });
    const g = w.grassLayer;
    this.grass.enabled = !!g && g.density > 0.02;
    if (g) {
      this.grass.setStyle({ color: hexToLinear(g.color).map((c) => c * 0.85), height: 0.45 + g.density * 0.45 * g.scale, patchiness: 1 - g.density * 0.8 });
      // make the ground under the grass match its colour at a distance
      const pal = { ...spec.terrain.palette };
      this.renderer.setPalette(pal);
    }
    this.#configureWeather(spec.environment, true);
    this.volumetrics.setMaxDistance(Math.min(900, w.hf.worldSize * 1.1));
  }

  #configureWeather(env, reset) {
    if (reset) this.weather.configure(env, this.spec?.seed ?? 1);
    else Object.assign(this.weather, { rain: env.rain, lightning: env.lightning, aurora: env.aurora });
    // rain replaces the ambient particles (a snowstorm stays a snowstorm)
    this.rainParticles = env.rain > 0 && env.particles !== 'snow';
    this.particles.setAmbient(this.rainParticles ? 'rain' : env.particles, 1);
  }

  /** Live-edit environment (Studio sliders): { timeOfDay, cloudCover, fogDensity, wind, particles, ... } */
  setEnvironment(env) {
    const { particles, rain, lightning, aurora, ...rest } = env;
    if (this.spec) Object.assign(this.spec.environment, env);
    const merged = this.spec?.environment ?? env;
    this.renderer.setEnvironment({ ...rest, ...skyForWeather(merged) });
    if (particles !== undefined || rain !== undefined || lightning !== undefined || aurora !== undefined) this.#configureWeather(merged, false);
  }

  setGrade(post) {
    this.renderer.setGrade(post);
    if (this.spec) Object.assign(this.spec.post, post);
  }

  play() {
    if (!this.game) return;
    this.audio.unlock();
    this.suppressPause = false;
    this.game.start();
    this.input.requestPointerLock();
    this.canvas.focus();
  }

  pause() {
    if (this.game?.state !== 'playing') return;
    this.game.pause(true);
    this.hud.endCard('Paused', 'Take a breather.', 'Click or press P to resume', '▶ Resume');
    this.hud.onPlay = () => this.resume();
  }

  resume() {
    if (this.game?.state !== 'paused') return;
    this.game.pause(false);
    this.hud.hideCard();
    this.hud.onPlay = () => this.play();
    this.input.requestPointerLock();
  }

  /** Return to the title screen (attract mode). */
  stop() {
    this.suppressPause = true;
    this.input.exitPointerLock();
    this.game?.stop();
    if (this.spec) this.hud.titleCard(this.spec);
    this.hud.onPlay = () => this.play();
  }

  #onGameEvent(type, d) {
    const hud = this.hud;
    switch (type) {
      case 'start': hud.playing(d, this.camera.mode === 'first'); hud.onPlay = () => this.play(); break;
      case 'score': {
        hud.update(d);
        const s = this.projectToScreen(d.at);
        if (s) hud.floatText(`+${d.delta}`, s[0], s[1]);
        break;
      }
      case 'lives': case 'tick': hud.update(d); break;
      case 'message': hud.toast(d.text); break;
      case 'world': this.#applyWorld(d); break;
      case 'win':
        this.suppressPause = true;
        this.input.exitPointerLock();
        this.conversations.close();
        hud.endCard('Victory!', d.message, `Score ${d.score} · ${formatTime(d.time)}`, '↻ Play again', this.options.nextLevel !== false);
        break;
      case 'lose':
        this.suppressPause = true;
        this.input.exitPointerLock();
        this.conversations.close();
        hud.endCard('Game over', d.message, `Score ${d.score} · ${formatTime(d.time)}`, '↻ Play again', this.options.nextLevel !== false);
        break;
      default: break;
    }
    this.emit('game', { type, ...d });
  }

  projectToScreen(p, lift = 1) {
    const r = this.renderer;
    if (!r.viewProjNJ || !p) return null;
    const out = [0, 0, 0];
    const m = r.viewProjNJ;
    const x = p[0], y = p[1] + lift, z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return null;
    out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    const rect = this.canvas.getBoundingClientRect();
    return [(out[0] * 0.5 + 0.5) * rect.width, (0.5 - out[1] * 0.5) * rect.height];
  }

  /** Screen position of p, pinned to the screen edge (edge: true) when it is off screen or behind. */
  projectToScreenEdge(p, label = '') {
    const r = this.renderer;
    if (!r.viewProjNJ || !p) return null;
    const m = r.viewProjNJ;
    const [x, y, z] = p;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    let nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / Math.abs(w || 1e-6);
    let ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / Math.abs(w || 1e-6);
    if (w < 0) { nx = -nx; ny = -ny; }
    const inside = w > 0 && Math.abs(nx) < 0.92 && Math.abs(ny) < 0.88;
    if (!inside) {
      const k = 0.9 / Math.max(Math.abs(nx) / 0.92, Math.abs(ny) / 0.88, 1e-6);
      nx *= k; ny *= k;
      if (w < 0 && Math.abs(ny) > Math.abs(nx)) ny = -Math.abs(ny) * 0.9;
    }
    const rect = this.canvas.getBoundingClientRect();
    return { x: (nx * 0.5 + 0.5) * rect.width, y: (0.5 - ny * 0.5) * rect.height, edge: !inside, label };
  }

  /**
   * The AI game master designs the next level from how this one went, then
   * it loads and starts. Emits 'level' with { spec, source, notes, level }.
   */
  async nextLevel() {
    if (!this.game || this.designing) return;
    this.designing = true;
    const telemetry = { ...this.game.telemetry(), level: this.level, talks: this.conversations.summary() };
    this.hud.nextLevelBusy('The game master is watching the replay…');
    try {
      const result = await designNextLevel({
        spec: this.spec, telemetry, endpoint: this.options.nextLevelEndpoint ?? '/api/next-level',
        onEvent: (type, data) => {
          if (type === 'thinking' && data.text) this.hud.nextLevelBusy(`“${(this.gmThought = ((this.gmThought ?? '') + data.text).slice(-160)).trim()}”`);
          if (type === 'status') this.hud.nextLevelBusy(data.message);
        },
      });
      this.gmThought = '';
      this.level++;
      this.load(result.spec);
      this.emit('level', { ...result, level: this.level });
      this.play();
      if (result.notes?.length) this.hud.toast(result.notes[0], 2600);
    } finally {
      this.designing = false;
    }
  }

  /**
   * Render the game from a few viewpoints for the art director. Returns
   * { images: [{ label, data }], stats: { luma, saturation, contrast } }.
   */
  captureViews({ width = 768 } = {}) {
    const w = this.world;
    if (!w) return { images: [], stats: { luma: 0.4, saturation: 0.3, contrast: 0.2 } };
    const spawn = w.spawn;
    const c = w.center;
    const dx = c[0] - spawn[0], dz = c[2] - spawn[2];
    const d = Math.hypot(dx, dz) || 1;
    const fx = d > 2 ? dx / d : Math.sin(this.game?.player.yaw ?? 0), fz = d > 2 ? dz / d : Math.cos(this.game?.player.yaw ?? 0);
    const size = w.hf.playSize;
    const ground = (x, z) => w.physics.surfaceAt(x, z);
    const views = [
      { label: "the player's view, starting out", position: [spawn[0] - fx * 5, spawn[1] + 2.6, spawn[2] - fz * 5], target: [spawn[0] + fx * 12, spawn[1] + 1.2, spawn[2] + fz * 12] },
      { label: 'establishing shot over the level', position: [c[0] - fx * size * 0.45, Math.max(ground(c[0] - fx * size * 0.45, c[2] - fz * size * 0.45) + 14, c[1] + size * 0.22), c[2] - fz * size * 0.45], target: [c[0], c[1] + 2, c[2]] },
      { label: 'low angle across the ground', position: [spawn[0] + fz * 8, ground(spawn[0] + fz * 8, spawn[2] - fx * 8) + 1.2, spawn[2] - fx * 8], target: [spawn[0] + fx * 20, spawn[1] + 3, spawn[2] + fz * 20] },
    ];
    const canvas2d = document.createElement('canvas');
    const h = Math.round(width * (this.canvas.height / Math.max(1, this.canvas.width)));
    canvas2d.width = width;
    canvas2d.height = h;
    const ctx = canvas2d.getContext('2d', { willReadFrequently: true });
    const images = [];
    let luma = 0, sat = 0, contrast = 0;
    for (const v of views) {
      // a few frames let temporal AA, exposure and the clouds settle
      for (let i = 0; i < 4; i++) this.renderer.render({ position: v.position, target: v.target, fovY: this.camera.fov, near: 0.1 }, 1 / 60);
      ctx.drawImage(this.canvas, 0, 0, width, h);
      images.push({ label: v.label, data: canvas2d.toDataURL('image/jpeg', 0.82) });
      const px = ctx.getImageData(0, 0, width, h).data;
      let l = 0, l2 = 0, s = 0, n = 0;
      for (let i = 0; i < px.length; i += 4 * 7) {
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        l += y; l2 += y * y; s += mx > 0 ? (mx - mn) / mx : 0; n++;
      }
      const mean = l / n;
      luma += mean; sat += s / n; contrast += Math.sqrt(Math.max(0, l2 / n - mean * mean));
    }
    const k = 1 / views.length;
    return { images, stats: { luma: luma * k, saturation: sat * k, contrast: contrast * k } };
  }

  /** Apply a character's power (see shared/npc.js); returns a short description for the chat. */
  applyCharacterAction(name, input, character) {
    return this.game?.applyAction(name, input, character) ?? '';
  }

  #applyWorld({ name, input }) {
    if (name === 'change_weather') {
      const env = {};
      if (input.rain !== undefined) env.rain = input.rain;
      if (input.lightning !== undefined) env.lightning = input.lightning;
      if (input.aurora !== undefined) env.aurora = input.aurora;
      if (input.clouds !== undefined) env.cloudCover = input.clouds;
      if (input.fog !== undefined) env.fogDensity = input.fog;
      if (env.rain > 0 && this.spec && this.spec.environment.particles !== 'snow') env.particles = 'rain';
      this.setEnvironment(env);
      if (env.lightning > 0) this.weather.nextStrike = Math.min(this.weather.nextStrike, 1.5);
      if (env.rain > 0) this.weather.wetness = Math.max(this.weather.wetness, 0.3);
    } else if (name === 'change_time') {
      // the sun sweeps forward to the new hour over a few seconds
      const from = this.spec?.environment.timeOfDay ?? 12;
      let to = input.hour;
      if (to < from) to += 24;
      this.timeTween = { from, to, t: 0, duration: 2 + Math.min(4, (to - from) * 0.4) };
    }
  }

  #updateTimeTween(dt) {
    const tw = this.timeTween;
    if (!tw) return;
    tw.t = Math.min(tw.duration, tw.t + dt);
    const k = tw.t / tw.duration;
    const e = k * k * (3 - 2 * k);
    this.setEnvironment({ timeOfDay: (tw.from + (tw.to - tw.from) * e) % 24 });
    if (k >= 1) this.timeTween = null;
  }

  /** A compact, current description of the game for characters (and the game master) to reason about. */
  describeWorld() {
    const spec = this.spec;
    const g = this.game;
    if (!spec || !g) return { title: '', summary: '', objective: '', hasGoal: false };
    const env = spec.environment;
    const hour = env.timeOfDay;
    const time = hour < 5 || hour >= 20.5 ? 'night' : hour < 7.5 ? 'dawn' : hour < 11 ? 'morning' : hour < 16 ? 'afternoon' : hour < 18 ? 'late afternoon' : 'sunset';
    const weather = [
      env.cloudCover > 0.7 ? 'overcast' : env.cloudCover > 0.3 ? 'partly cloudy' : 'clear skies',
      env.rain > 0 ? `rain (${Math.round(env.rain * 100)}%)` : null,
      env.lightning > 0 ? 'thunderstorm' : null,
      env.aurora > 0 && time === 'night' ? 'northern lights' : null,
      env.fogDensity > 0.5 ? 'thick fog' : null,
      env.particles !== 'none' ? env.particles : null,
    ].filter(Boolean).join(', ');
    const alive = this.world.entities.filter((e) => e.alive);
    const roles = new Map();
    for (const e of alive) {
      const kinds = e.behaviors.map((b) => b.type).filter((t) => !['spin', 'bob', 'light'].includes(t));
      const key = `${e.prefab.id} (${kinds.join(', ') || 'scenery'})`;
      roles.set(key, (roles.get(key) ?? 0) + 1);
    }
    const things = [...roles].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${n} × ${k}`).join('; ');
    const p = g.player.pos;
    const goal = alive.find((e) => e.behaviors.some((b) => b.type === 'goal'));
    const dir = (t) => {
      const dx = t[0] - p[0], dz = t[2] - p[2];
      const d = Math.round(Math.hypot(dx, dz));
      const compass = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][((Math.round(Math.atan2(dx, dz) / (Math.PI / 4)) % 8) + 8) % 8];
      return `${d} m to the ${compass}`;
    };
    const others = g.characters.map((c) => `${c.name} (${c.spec.role})${c.following ? ', following the player' : ''}`).join('; ');
    const r = spec.rules;
    const lines = [
      `"${spec.title}": ${spec.tagline}`,
      `Objective: ${r.objective} (goal type: ${r.goal}${r.goal === 'collect' ? `, need ${r.targetScore || 'all the'} points` : ''}).`,
      `Setting: ${spec.terrain.style} terrain, ${time}, ${weather}.`,
      `Player: score ${g.score}${r.targetScore ? ` of ${r.targetScore}` : ''}, ${g.lives} of ${spec.player.lives} lives${g.timeLeft !== null ? `, ${Math.ceil(g.timeLeft)} s left` : ''}, collected ${g.collected} of ${g.totalCollectibles} treasures.`,
      goal ? `The goal (${goal.prefab.id}) is ${dir(goal.pos)} of the player.` : null,
      `In the world: ${things || 'nothing much'}.`,
      others ? `Characters: ${others}.` : null,
    ].filter(Boolean);
    return { title: spec.title, summary: lines.join('\n'), objective: r.objective, hasGoal: !!goal };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      // save power on the title screen and when paused
      const idle = !this.game || this.game.state !== 'playing';
      if (idle && now - this.last < 1000 / this.menuFps - 2) return;
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Advance and render one frame (also usable for deterministic capture). */
  frame(dt) {
    if (!this.game) return;
    this.input.update();
    const talking = this.conversations.isOpen;
    const paused = this.game.state === 'paused';
    this.renderer.adaptive = this.game.state === 'playing';
    if (!talking && this.game.state === 'playing' && this.game.nearCharacter && this.input.pressed.has('KeyE')) this.conversations.open(this.game.nearCharacter);
    // the world holds still while you talk (weather and the sky keep moving)
    const cam = this.game.update(paused || talking ? 0 : dt, this.input);
    this.#updateTimeTween(dt);
    const f = this.renderer.flash;
    f[3] *= Math.exp(-dt * 6);
    this.#updateWeather(paused ? 0 : dt, cam);
    const w = this.world;
    const active = this.game.state === 'playing' && !paused;
    this.interaction.trackPlayer(this.game.player, active ? dt : 0, (x, z) => w.hf.heightAt(x, z), w.lava ? null : w.waterLevel);
    this.renderer.render(cam, paused ? 0.0001 : dt);
    this.conversations.updateOverlay();
    this.input.endFrame();
    this.emit('frame', this.renderer.stats);
  }

  #updateWeather(dt, cam) {
    const fwd = [cam.target[0] - cam.position[0], cam.target[1] - cam.position[1], cam.target[2] - cam.position[2]];
    const w = this.weather.update(dt, fwd);
    this.renderer.weatherFx = w.fx;
    this.renderer.flashPos = w.flashDir;
    for (const e of w.events) if (e.type === 'thunder') this.audio.thunder(e);
    const rain = w.fx[1];
    this.audio.setRain(this.rainParticles ? rain : 0);
    if (this.rainParticles) this.particles.setAmbient('rain', Math.min(1, 0.15 + rain * 1.1));
  }

  stopLoop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stopLoop();
    this.input.destroy();
    this.audio.destroy();
    this.conversations.destroy();
    this.hud.destroy();
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKey);
    this.world?.scene?.destroy();
    this.renderer.device.destroy();
  }
}

function formatTime(t) {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export { normalizeSpec, isLava, mat4 };
