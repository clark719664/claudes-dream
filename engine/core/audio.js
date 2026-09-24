// Procedural audio: every sound effect is synthesised with WebAudio and the
// soundtrack is generated live from a mood + tempo, so games need no audio
// files at all. A spatial panner gives positional cues for nearby events.

const SCALES = {
  calm: [0, 2, 4, 7, 9],          // major pentatonic
  upbeat: [0, 2, 4, 5, 7, 9, 11], // major
  tense: [0, 1, 3, 5, 6, 8, 10],  // locrian-ish
  mystic: [0, 2, 3, 7, 8],        // hirajoshi-like
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.7;
    this.musicMood = 'none';
    this.tempo = 90;
  }

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock() {
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.32;
      // simple feedback-delay reverb for the music
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = 0.28;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.35;
      const tone = this.ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2200;
      this.musicBus.connect(this.master);
      this.musicBus.connect(delay);
      delay.connect(tone).connect(fb).connect(delay);
      tone.connect(this.master);
      this.noise = this.#noiseBuffer();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.musicMood !== 'none' && !this.musicTimer) this.#startMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  #noiseBuffer() {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  #tone({ freq = 440, to = null, type = 'sine', dur = 0.2, gain = 0.3, when = 0, attack = 0.005, bus = this.sfxBus, detune = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  #noise({ dur = 0.2, gain = 0.3, freq = 1200, q = 1, type = 'bandpass', when = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    const p = opts.pitch ?? 1;
    switch (name) {
      case 'jump': this.#tone({ freq: 260 * p, to: 520 * p, type: 'triangle', dur: 0.18, gain: 0.18 }); break;
      case 'land': this.#noise({ dur: 0.09, gain: 0.15, freq: 300, type: 'lowpass' }); break;
      case 'step': this.#noise({ dur: 0.05, gain: 0.04, freq: 900, q: 0.7 }); break;
      case 'collect': {
        const base = 660 * p;
        [0, 4, 7, 12].forEach((s, i) => this.#tone({ freq: base * 2 ** (s / 12), type: 'sine', dur: 0.22, gain: 0.14, when: i * 0.045 }));
        this.#tone({ freq: base * 4, type: 'triangle', dur: 0.35, gain: 0.05, when: 0.18 });
        break;
      }
      case 'hurt':
        this.#tone({ freq: 180, to: 60, type: 'sawtooth', dur: 0.35, gain: 0.2 });
        this.#noise({ dur: 0.25, gain: 0.2, freq: 500, q: 0.5 });
        break;
      case 'heal': [0, 7, 12].forEach((s, i) => this.#tone({ freq: 523 * 2 ** (s / 12), type: 'triangle', dur: 0.3, gain: 0.12, when: i * 0.08 })); break;
      case 'bounce': this.#tone({ freq: 180, to: 900, type: 'sine', dur: 0.3, gain: 0.22 }); break;
      case 'checkpoint': [0, 5, 9, 12, 17].forEach((s, i) => this.#tone({ freq: 440 * 2 ** (s / 12), type: 'triangle', dur: 0.3, gain: 0.1, when: i * 0.06 })); break;
      case 'shoot': this.#tone({ freq: 900, to: 200, type: 'square', dur: 0.15, gain: 0.07 }); break;
      case 'win':
        [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.#tone({ freq: 392 * 2 ** (s / 12), type: 'triangle', dur: 0.6, gain: 0.12, when: i * 0.09 }));
        [0, 4, 7].forEach((s) => this.#tone({ freq: 196 * 2 ** (s / 12), type: 'sine', dur: 1.8, gain: 0.1, when: 0.6 }));
        break;
      case 'lose': [0, -3, -6, -10].forEach((s, i) => this.#tone({ freq: 330 * 2 ** (s / 12), type: 'sawtooth', dur: 0.45, gain: 0.08, when: i * 0.18 })); break;
      case 'click': this.#tone({ freq: 1200, type: 'sine', dur: 0.05, gain: 0.05 }); break;
      default: break;
    }
  }

  setMusic(mood, tempo = 90) {
    this.musicMood = mood;
    this.tempo = tempo;
    this.#stopMusic();
    if (this.ctx && mood !== 'none') this.#startMusic();
  }

  #stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  // Generative score: a slow pad, a bass pulse and a wandering arpeggio,
  // scheduled slightly ahead of time for sample-accurate timing.
  #startMusic() {
    const scale = SCALES[this.musicMood] ?? SCALES.calm;
    const root = { calm: 57, upbeat: 60, tense: 52, mystic: 55 }[this.musicMood] ?? 57;
    const beat = 60 / this.tempo;
    const midi = (n) => 440 * 2 ** ((n - 69) / 12);
    let step = 0;
    let next = this.ctx.currentTime + 0.1;
    let chord = 0;
    const progression = [0, 3, 4, 2];
    const note = (deg, oct = 0) => root + scale[((deg % scale.length) + scale.length) % scale.length] + 12 * (Math.floor(deg / scale.length) + oct);
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) return;
      while (next < this.ctx.currentTime + 0.25) {
        const when = next - this.ctx.currentTime;
        if (step % 16 === 0) {
          chord = progression[(step / 16) % progression.length];
          for (const d of [0, 2, 4]) this.#tone({ freq: midi(note(chord + d, -1)), type: 'sine', dur: beat * 16, gain: 0.05, attack: beat * 2, when, bus: this.musicBus, detune: (Math.random() - 0.5) * 8 });
        }
        if (step % 4 === 0 && this.musicMood !== 'calm') this.#tone({ freq: midi(note(chord, -2)), type: 'triangle', dur: beat * 1.5, gain: 0.08, when, bus: this.musicBus });
        const density = { calm: 0.35, upbeat: 0.75, tense: 0.55, mystic: 0.4 }[this.musicMood] ?? 0.4;
        if (Math.random() < density) {
          const deg = chord + [0, 2, 4, 5, 7][Math.floor(Math.random() * 5)];
          this.#tone({ freq: midi(note(deg, 1)), type: this.musicMood === 'tense' ? 'sawtooth' : 'triangle', dur: beat * 1.8, gain: this.musicMood === 'tense' ? 0.025 : 0.05, when, bus: this.musicBus });
        }
        next += beat / 2;
        step++;
      }
    }, 60);
  }

  destroy() {
    this.#stopMusic();
    this.ctx?.close();
  }
}
