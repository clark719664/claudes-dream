import './style.css';
import { Game } from './game/game';
import { Renderer } from './game/render';
import { Phase } from './game/types';
import { CFG } from './game/config';
import { dailySeed, randomSeed } from './core/rng';
import { initAudio, sfx, unlockAudio } from './core/audio';
import { haptics } from './core/haptics';
import {
  activePerks,
  addShards,
  loadProfile,
  profile,
  queuePack,
  recordRun,
  saveProfile,
  todayKey,
} from './meta/profile';
import {
  closeOverlay,
  helpScreen,
  homeScreen,
  initScreens,
  pauseScreen,
  resultsScreen,
} from './ui/screens';
import { fmt } from './ui/dom';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const renderer = new Renderer(canvas, ctx);

const hud = document.getElementById('hud') as HTMLElement;
const hudScore = document.getElementById('hud-score') as HTMLElement;
const hudWave = document.getElementById('hud-wave') as HTMLElement;
const hudShards = document.getElementById('hud-shards') as HTMLElement;
const hudPause = document.getElementById('hud-pause') as HTMLButtonElement;

let game: Game | null = null;
let paused = false;
let dailyKey: string | null = null;
let resultShown = false;

// ---------------------------------------------------------------- loop ---
const STEP = 1000 / 60;
let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const delta = Math.min(now - last, 250);
  last = now;

  if (game && !paused) {
    accumulator += delta;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      game.tick();
      accumulator -= STEP;
      steps++;
    }
    consumeFx();
    if (game.phase === Phase.Over && !resultShown) endRun();
  }

  if (game) {
    renderer.draw(game);
    updateHud();
  }
  requestAnimationFrame(frame);
}

function consumeFx(): void {
  if (!game) return;
  const events = game.drainFx();
  if (!events.length) return;
  renderer.ingest(events);

  for (const fx of events) {
    switch (fx.kind) {
      case 'launch':
        sfx.launch();
        break;
      case 'resonate':
        sfx.resonate(fx.value);
        if (fx.value > 0) haptics.hit();
        break;
      case 'chip':
        sfx.chip();
        break;
      case 'cascade':
        sfx.cascade(fx.value);
        haptics.cascade(fx.value);
        break;
      case 'bomb':
        sfx.bomb();
        haptics.bomb();
        break;
      case 'pickup':
        sfx.pickup();
        break;
      case 'wave':
        sfx.wave();
        break;
      case 'gameover':
        sfx.gameOver();
        haptics.gameOver();
        break;
      default:
        break;
    }
  }
}

function updateHud(): void {
  if (!game) return;
  hudScore.textContent = fmt(game.score);
  hudWave.textContent = String(game.wave);
  hudShards.textContent = fmt(game.shards * game.perks.shardMultiplier);
}

// --------------------------------------------------------------- input ---
function pointerToField(ev: PointerEvent): { x: number; y: number } {
  return renderer.toField(ev.clientX, ev.clientY);
}

canvas.addEventListener('pointerdown', (ev) => {
  unlockAudio();
  if (!game || paused || !game.canFire) return;
  canvas.setPointerCapture(ev.pointerId);
  game.aiming = true;
  const p = pointerToField(ev);
  game.aimAt(p.x, p.y);
});

canvas.addEventListener('pointermove', (ev) => {
  if (!game || !game.aiming) return;
  const p = pointerToField(ev);
  game.aimAt(p.x, p.y);
});

function releaseAim(ev: PointerEvent): void {
  if (!game || !game.aiming) return;
  game.aiming = false;
  const p = pointerToField(ev);
  // Dragging below the launcher is the cancel gesture.
  if (p.y < game.launcherY - 0.2 && game.fire()) haptics.tap();
}

canvas.addEventListener('pointerup', releaseAim);
canvas.addEventListener('pointercancel', () => {
  if (game) game.aiming = false;
});

hudPause.addEventListener('click', () => {
  if (!game || game.phase === Phase.Over) return;
  paused = true;
  sfx.uiTap();
  pauseScreen();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && game.phase !== Phase.Over && !paused) {
    paused = true;
    pauseScreen();
  }
});

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 120));

// ------------------------------------------------------------ lifecycle --
function startRun(daily: boolean): void {
  dailyKey = daily ? todayKey() : null;
  resultShown = false;
  paused = false;
  accumulator = 0;
  game = new Game({
    seed: daily ? dailySeed() : randomSeed(),
    perks: activePerks(),
    dailyKey,
  });
  hud.hidden = false;
  closeOverlay();
  renderer.resize();
}

function endRun(): void {
  if (!game) return;
  resultShown = true;
  const result = game.result;

  const { newBest } = recordRun({
    score: result.score,
    wave: result.waves,
    bestChain: result.bestChain,
    blocksBroken: result.blocksBroken,
    daily: dailyKey,
  });

  addShards(result.shards);

  // Packs are the reason to push for one more wave.
  const packsWon: string[] = [];
  const milestones = Math.min(3, Math.floor(result.waves / 12));
  for (let i = 1; i <= milestones; i++) {
    const reason = `Reached wave ${i * 12}`;
    queuePack(i >= 3 ? 'premium' : 'standard', reason);
    packsWon.push(reason);
  }
  if (newBest) {
    queuePack('standard', 'New personal best');
    packsWon.push('New personal best');
  }
  if (result.bestChain >= 4) {
    queuePack('standard', `Chain ×${result.bestChain}`);
    packsWon.push(`Chain ×${result.bestChain}`);
  }
  saveProfile();

  setTimeout(() => {
    hud.hidden = true;
    resultsScreen({
      score: result.score,
      wave: result.waves,
      shards: result.shards,
      bestChain: result.bestChain,
      blocksBroken: result.blocksBroken,
      newBest,
      daily: dailyKey,
      packsWon,
    });
  }, 900);
}

function goHome(): void {
  game = null;
  paused = false;
  hud.hidden = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  homeScreen();
}

initScreens({
  play: (daily) => startRun(daily),
  resume: () => {
    paused = false;
    last = performance.now();
    closeOverlay();
  },
  restart: () => startRun(dailyKey !== null),
  home: goHome,
});

// ----------------------------------------------------------------- boot --
/** Native shell touches that are no-ops in a browser. */
async function setupNativeShell(): Promise<void> {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
}

loadProfile();
initAudio(profile.muted);
renderer.resize();
void setupNativeShell();

if (!profile.seenIntro) {
  profile.seenIntro = true;
  saveProfile();
  helpScreen(() => homeScreen());
} else {
  homeScreen();
}

requestAnimationFrame((t) => {
  last = t;
  frame(t);
});

// Exposed for the balance notes in docs/GAME_DESIGN.md.
(window as unknown as { PRISM_CFG: typeof CFG }).PRISM_CFG = CFG;
