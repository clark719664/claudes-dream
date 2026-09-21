import './style.css';
import { Game } from './game/game';
import { Renderer, type DragState } from './game/render';
import { Phase } from './game/types';
import { CFG } from './game/config';
import { LEVELS, levelById, objectiveText } from './game/levels';
import { initAudio, sfx, unlockAudio } from './core/audio';
import { haptics } from './core/haptics';
import {
  activePerks,
  addShards,
  loadProfile,
  profile,
  queuePack,
  recordLevel,
  saveProfile,
} from './meta/profile';
import {
  closeOverlay,
  helpScreen,
  homeScreen,
  initScreens,
  mapScreen,
  pauseScreen,
  resultsScreen,
} from './ui/screens';
import { fmt } from './ui/dom';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const renderer = new Renderer(canvas, ctx);

const hud = document.getElementById('hud') as HTMLElement;
const hudScore = document.getElementById('hud-score') as HTMLElement;
const hudShots = document.getElementById('hud-shots') as HTMLElement;
const hudGoalText = document.getElementById('hud-goal-text') as HTMLElement;
const hudGoalBar = document.getElementById('hud-goal-bar') as HTMLElement;
const hudGoalCount = document.getElementById('hud-goal-count') as HTMLElement;
const hudPause = document.getElementById('hud-pause') as HTMLButtonElement;

let game: Game | null = null;
let paused = false;
let resultShown = false;
let drag: DragState | null = null;

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
    if (game.phase === Phase.Over && !resultShown) endLevel();
  }

  if (game) {
    renderer.draw(game, drag);
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
      case 'place':
        sfx.chip();
        haptics.tap();
        break;
      case 'clearLine':
        sfx.resonate(Math.min(6, fx.value));
        haptics.hit();
        break;
      case 'clearGroup':
        sfx.cascade(Math.min(5, Math.floor(fx.value / 2)));
        haptics.hit();
        break;
      case 'combo':
        sfx.pickup();
        haptics.cascade(fx.value);
        break;
      case 'bomb':
        sfx.bomb();
        haptics.bomb();
        break;
      case 'deal':
        sfx.uiTap();
        break;
      case 'creep':
        sfx.wave();
        break;
      case 'win':
        sfx.setComplete();
        haptics.reward();
        break;
      case 'lose':
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
  hudShots.textContent = String(Math.max(0, game.movesLeft));
  hudShots.classList.toggle('low', game.movesLeft <= 3);
  hudGoalBar.style.width = `${Math.round(game.objectiveProgress() * 100)}%`;
  hudGoalCount.textContent = game.objectiveCounter();
}

// --------------------------------------------------------------- input ---
/**
 * One gesture: press a tray piece, drag it onto the board, let go. The piece is
 * drawn above the finger so it is never hidden by the hand, and the cell it
 * snaps to is offset to match — what the preview outlines is what gets placed.
 */
function targetCellFor(item: DragState['item'], clientX: number, clientY: number) {
  const anchor = renderer.toCell(clientX, clientY - renderer.layout().cell * 1.6);
  return {
    col: anchor.col - Math.floor((item.shape.w - 1) / 2),
    row: anchor.row - Math.floor((item.shape.h - 1) / 2),
  };
}

canvas.addEventListener('pointerdown', (ev) => {
  unlockAudio();
  if (!game || paused || game.phase !== Phase.Placing) return;

  const slot = renderer.traySlotAt(ev.clientX, ev.clientY);
  const item = slot >= 0 ? game.tray[slot] : undefined;
  if (!item || item.used) return;
  if (!game.board.hasAnyPlacement(item.shape)) {
    haptics.tap();
    return;
  }

  canvas.setPointerCapture(ev.pointerId);
  const p = renderer.toLocal(ev.clientX, ev.clientY);
  drag = { item, px: p.x, py: p.y, target: targetCellFor(item, ev.clientX, ev.clientY) };
  haptics.tap();
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const p = renderer.toLocal(ev.clientX, ev.clientY);
  drag.px = p.x;
  drag.py = p.y;
  drag.target = targetCellFor(drag.item, ev.clientX, ev.clientY);
});

function endDrag(ev: PointerEvent): void {
  if (!game || !drag) return;
  const held = drag;
  drag = null;
  const target = targetCellFor(held.item, ev.clientX, ev.clientY);
  if (game.place(held.item, target.col, target.row)) {
    haptics.hit();
  }
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => {
  drag = null;
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
let currentLevelId = 1;

function startLevel(levelId: number): void {
  const spec = levelById(levelId);
  if (!spec) return goHome();

  currentLevelId = levelId;
  resultShown = false;
  paused = false;
  drag = null;
  accumulator = 0;
  game = new Game(spec, activePerks());

  hudGoalText.textContent = `L${spec.id} · ${objectiveText(spec.objective)}`;
  hud.hidden = false;
  closeOverlay();
  renderer.resize();
}

function endLevel(): void {
  if (!game) return;
  resultShown = true;
  const r = game.result;
  const level = game.level;

  const { firstClear } = recordLevel({
    levelId: r.levelId,
    won: r.won,
    score: r.score,
    stars: r.stars,
    bestChain: r.bestCombo,
    blocksBroken: r.tilesCleared,
  });

  let shards = 0;
  const packsWon: string[] = [];
  if (r.won) {
    shards =
      CFG.shards.levelClear +
      r.stars * CFG.shards.perStar +
      (firstClear ? CFG.shards.firstClearBonus : 0);
    shards = Math.round(shards * game.perks.shardMultiplier);
    addShards(shards);

    // Packs are what pull a player back, so they hang off the moments worth
    // repeating rather than off simply finishing.
    if (firstClear && level.id % 3 === 0) {
      queuePack(level.id % 9 === 0 ? 'premium' : 'standard', `Cleared level ${level.id}`);
      packsWon.push(`Cleared level ${level.id}`);
    }
    if (r.stars === 3) {
      queuePack('standard', `Three stars on ${level.name}`);
      packsWon.push(`Three stars on ${level.name}`);
    }
    saveProfile();
  }

  const next = LEVELS.find((l) => l.id === level.id + 1);

  setTimeout(() => {
    hud.hidden = true;
    resultsScreen({
      level,
      won: r.won,
      score: r.score,
      stars: r.stars,
      shards,
      movesLeft: r.movesLeft,
      bestCombo: r.bestCombo,
      linesCleared: r.linesCleared,
      firstClear,
      nextLevelId: next ? next.id : null,
      packsWon,
    });
  }, 1100);
}

function goHome(): void {
  game = null;
  paused = false;
  hud.hidden = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  homeScreen();
}

function goMap(): void {
  game = null;
  paused = false;
  hud.hidden = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  mapScreen();
}

initScreens({
  play: (levelId) => startLevel(levelId),
  resume: () => {
    paused = false;
    last = performance.now();
    closeOverlay();
  },
  restart: () => startLevel(currentLevelId),
  home: goHome,
  map: goMap,
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
