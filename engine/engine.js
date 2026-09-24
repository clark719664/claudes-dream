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
import { buildWorld, isLava, skyForWeather } from './game/builder.js';
import { Weather } from './game/weather.js';
import { Game } from './game/game.js';
import { CameraRig } from './game/camera.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { HUD } from './ui/hud.js';
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
      case 'win':
        this.suppressPause = true;
        this.input.exitPointerLock();
        hud.endCard('Victory!', d.message, `Score ${d.score} · ${formatTime(d.time)}`);
        break;
      case 'lose':
        this.suppressPause = true;
        this.input.exitPointerLock();
        hud.endCard('Game over', d.message, `Score ${d.score} · ${formatTime(d.time)}`);
        break;
      default: break;
    }
    this.emit('game', { type, ...d });
  }

  projectToScreen(p) {
    const r = this.renderer;
    if (!r.viewProjNJ || !p) return null;
    const out = [0, 0, 0];
    const m = r.viewProjNJ;
    const x = p[0], y = p[1] + 1, z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return null;
    out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    const rect = this.canvas.getBoundingClientRect();
    return [(out[0] * 0.5 + 0.5) * rect.width, (0.5 - out[1] * 0.5) * rect.height];
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
    const paused = this.game.state === 'paused';
    this.renderer.adaptive = this.game.state === 'playing';
    const cam = this.game.update(paused ? 0 : dt, this.input);
    const f = this.renderer.flash;
    f[3] *= Math.exp(-dt * 6);
    this.#updateWeather(paused ? 0 : dt, cam);
    this.renderer.render(cam, paused ? 0.0001 : dt);
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
