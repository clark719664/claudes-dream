/**
 * Every sound is synthesised at runtime, so the game ships with no audio
 * assets and the whole bundle stays small enough to load instantly on mobile.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

export function initAudio(startMuted = false): void {
  muted = startMuted;
  if (ctx) return;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.28;
  master.connect(ctx.destination);
}

/** iOS only unlocks audio inside a user gesture, so call this from the first tap. */
export function unlockAudio(): void {
  if (!ctx) initAudio(muted);
  if (ctx?.state === 'suspended') void ctx.resume();
}

export function setMuted(value: boolean): void {
  muted = value;
  if (master) master.gain.value = muted ? 0 : 0.28;
}

export function isMuted(): boolean {
  return muted;
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  gain = 0.3,
  sweepTo?: number,
): void {
  if (!ctx || !master || muted) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), now + duration);

  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(gain, now + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(env);
  env.connect(master);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function noise(duration: number, gain = 0.2, filterHz = 1200): void {
  if (!ctx || !master || muted) return;
  const now = ctx.currentTime;
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterHz;
  const env = ctx.createGain();
  env.gain.value = gain;
  src.connect(filter);
  filter.connect(env);
  env.connect(master);
  src.start(now);
}

/** Pentatonic ladder so stacked hits always land in key. */
const SCALE = [392, 440, 494, 587, 659, 784, 880, 988, 1175, 1319];

export const sfx = {
  launch: () => tone(180, 0.09, 'triangle', 0.18, 90),
  chip: () => tone(320, 0.06, 'triangle', 0.1),
  resonate: (streak: number) => {
    tone(SCALE[Math.min(SCALE.length - 1, streak)], 0.12, 'triangle', 0.22);
    noise(0.05, 0.06, 2600);
  },
  cascade: (chain: number) => {
    const base = SCALE[Math.min(SCALE.length - 1, chain + 1)];
    tone(base, 0.28, 'sawtooth', 0.16);
    tone(base * 1.5, 0.22, 'sine', 0.13);
    noise(0.16, 0.12, 900);
  },
  bomb: () => {
    noise(0.34, 0.3, 500);
    tone(90, 0.3, 'sawtooth', 0.22, 40);
  },
  pickup: () => {
    tone(880, 0.08, 'sine', 0.2);
    tone(1320, 0.12, 'sine', 0.16);
  },
  wave: () => tone(150, 0.2, 'sine', 0.12, 220),
  gameOver: () => {
    tone(330, 0.5, 'sawtooth', 0.2, 60);
    noise(0.5, 0.18, 400);
  },
  uiTap: () => tone(600, 0.04, 'sine', 0.13),
  packOpen: () => {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => tone(f, 0.22, 'triangle', 0.2), i * 80);
    });
  },
  reveal: (rarity: number) => {
    const base = 440 + rarity * 110;
    tone(base, 0.18, 'triangle', 0.22);
    if (rarity >= 4) {
      tone(base * 1.5, 0.3, 'sine', 0.18);
      noise(0.25, 0.1, 3000);
    }
  },
  setComplete: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      setTimeout(() => tone(f, 0.4, 'triangle', 0.24), i * 110);
    });
  },
};
