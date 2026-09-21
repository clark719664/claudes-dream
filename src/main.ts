import './style.css';
import { Game } from './game/game';
import { Renderer, type DragState } from './game/render';
import { Phase } from './game/types';
import { CFG } from './game/config';
import { LEVELS, levelById, objectiveText } from './game/levels';
import { CLASSIC } from './game/game';
import { initAudio, sfx, unlockAudio } from './core/audio';
import { haptics } from './core/haptics';
import {
  activePerks,
  addShards,
  addXp,
  classicXp,
  levelClearXp,
  loadProfile,
  profile,
  queuePack,
  addCharges,
  classicCharges,
  levelCharges,
  recordClassic,
  recordLevel,
  saveProfile,
} from './meta/profile';
import {
  classicResultsScreen,
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
    // Animation is driven by elapsed time, not by however many frames the
    // device managed, so the game feels the same at 30fps as at 60.
    renderer.advance(delta / STEP);
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
        sfx.resonate(Math.min(8, fx.value * 2));
        haptics.hit();
        break;
      case 'gem':
        sfx.pickup();
        haptics.reward();
        break;
      case 'discard':
        sfx.uiTap();
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

/** The displayed score chases the real one, so a big clear reads as a payout. */
let shownScore = 0;

function updateHud(): void {
  if (!game) return;
  const gap = game.score - shownScore;
  shownScore = Math.abs(gap) < 2 ? game.score : shownScore + Math.ceil(gap * 0.18);
  hudScore.textContent = fmt(shownScore);
  hudShots.textContent = Number.isFinite(game.movesLeft)
    ? String(Math.max(0, game.movesLeft))
    : '∞';
  hudShots.classList.toggle('low', game.movesLeft <= 3);
  hudGoalBar.style.width = `${Math.round(game.objectiveProgress() * 100)}%`;
  hudGoalCount.textContent = game.objectiveCounter();
}

// --------------------------------------------------------------- input ---
/**
 * One gesture: press a tray piece, drag it, let go. The renderer owns where a
 * drag lands, so what is drawn and what is placed cannot disagree.
 */
canvas.addEventListener('pointerdown', (ev) => {
  unlockAudio();
  if (!game || paused || game.phase !== Phase.Placing) return;

  const slot = renderer.traySlotAt(ev.clientX, ev.clientY);
  const item = slot >= 0 ? game.tray[slot] : undefined;
  if (!item || item.used) return;

  // A piece with nowhere to go can be thrown away, if a discard is spare.
  if (!game.board.hasAnyPlacementCached(item.shape)) {
    if (game.discard(item)) haptics.reward();
    else haptics.tap();
    return;
  }

  canvas.setPointerCapture(ev.pointerId);
  const p = renderer.toLocal(ev.clientX, ev.clientY);
  drag = { item, px: p.x, py: p.y };
  haptics.tap();
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const p = renderer.toLocal(ev.clientX, ev.clientY);
  drag.px = p.x;
  drag.py = p.y;
});

function endDrag(ev: PointerEvent): void {
  if (!game || !drag) return;
  const held = drag;
  const p = renderer.toLocal(ev.clientX, ev.clientY);
  held.px = p.x;
  held.py = p.y;
  const target = renderer.dragTarget(held);
  drag = null;
  if (game.place(held.item, target.col, target.row)) haptics.hit();
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
let classicMode = false;

function startClassic(): void {
  classicMode = true;
  resultShown = false;
  paused = false;
  drag = null;
  shownScore = 0;
  accumulator = 0;
  game = new Game(CLASSIC, activePerks());
  hudGoalText.textContent = 'Classic · lines';
  hud.hidden = false;
  closeOverlay();
  renderer.resize();
}

function startLevel(levelId: number): void {
  const spec = levelById(levelId);
  if (!spec) return goHome();

  classicMode = false;
  currentLevelId = levelId;
  shownScore = 0;
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

  if (r.endless) {
    const previousBest = profile.classicBest;
    const newBest = recordClassic(r.score, r.linesCleared, r.tilesCleared);
    // Classic feeds the album too, or there would be no reason to play it
    // once the levels are done.
    const shards = Math.min(
      CFG.classic.maxShardsPerRun,
      Math.round(r.score * CFG.classic.shardsPerPoint * game.perks.shardMultiplier),
    );
    addShards(shards);
    if (newBest && previousBest > 0) queuePack('standard', 'New Classic high score');
    const xp = classicXp(r.score);
    const levelUp = addXp(xp);
    const charges = classicCharges(r.score);
    addCharges(charges);
    saveProfile();

    setTimeout(() => {
      hud.hidden = true;
      classicResultsScreen({
        score: r.score,
        lines: r.linesCleared,
        bestCombo: r.bestCombo,
        tiles: r.tilesCleared,
        monochrome: r.monochromeLines,
        perfectClears: r.perfectClears,
        newBest,
        previousBest,
        shards,
        xp,
        levelledTo: levelUp.to > levelUp.from ? levelUp.to : null,
        charges,
      });
    }, 1000);
    return;
  }

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

  const xp = r.won ? levelClearXp(r.stars, firstClear) : 10;
  const levelUp = addXp(xp);
  const charges = r.won ? levelCharges(r.stars, firstClear) : 0;
  if (charges) addCharges(charges);
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
      xp,
      levelledTo: levelUp.to > levelUp.from ? levelUp.to : null,
      charges,
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
  classic: startClassic,
  resume: () => {
    paused = false;
    last = performance.now();
    closeOverlay();
  },
  restart: () => (classicMode ? startClassic() : startLevel(currentLevelId)),
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

/**
 * Register the service worker so the game installs to a home screen and runs
 * offline. Failure here is never fatal — it just means no offline copy.
 */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(new URL('sw.js', location.href)).catch(() => {});
  });
}

loadProfile();
registerServiceWorker();
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
