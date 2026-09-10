/**
 * Procedural sound. Everything is synthesised with WebAudio so the game ships
 * without a single audio asset and works offline.
 */

const SCALES = [
  [0, 3, 5, 7, 10], // minor pentatonic  - Amethyst Hollow
  [0, 2, 3, 7, 8],  // phrygian-ish      - Ember Deep
  [0, 2, 4, 7, 9],  // major pentatonic  - Frost Vein
  [0, 1, 5, 6, 10], // unsettled         - The Void Reach
];

export class AudioKit {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.noiseBuf = null;
    this.step = 0;
    this.timer = null;
    this.root = 55;
    this.scale = SCALES[0];
    this.musicOn = false;
  }

  /** Must be called from a user gesture (autoplay policy). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 8;
    this.master.connect(comp).connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);

    const len = this.ctx.sampleRate * 0.6;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02);
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  tone({ freq = 440, to = null, type = 'sine', dur = 0.2, gain = 0.2, attack = 0.004, dest = null, detune = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, gain = 0.2, freq = 900, to = null, q = 1, type = 'bandpass' }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // --- game events -----------------------------------------------------
  fire(raging) {
    this.noise({ dur: raging ? 0.16 : 0.22, gain: raging ? 0.12 : 0.16, freq: 2600, to: 420, q: 1.2 });
    this.tone({ freq: raging ? 180 : 240, to: 70, type: 'sawtooth', dur: 0.18, gain: 0.1 });
  }
  fizzle() { this.noise({ dur: 0.12, gain: 0.07, freq: 700, to: 240, q: 3 }); }
  gem(stepIdx = 1) {
    const semis = this.scale[Math.min(this.scale.length - 1, stepIdx % this.scale.length)] + 12 * Math.floor(stepIdx / this.scale.length);
    const f = this.root * 8 * Math.pow(2, semis / 12);
    this.tone({ freq: f, type: 'triangle', dur: 0.22, gain: 0.16 });
    this.tone({ freq: f * 2, type: 'sine', dur: 0.14, gain: 0.06 });
  }
  heart() {
    [0, 4, 7, 12].forEach((s, i) => setTimeout(() => this.tone({ freq: 440 * Math.pow(2, s / 12), type: 'triangle', dur: 0.3, gain: 0.14 }), i * 55));
  }
  kill() {
    this.noise({ dur: 0.24, gain: 0.16, freq: 1600, to: 180, q: 0.9 });
    this.tone({ freq: 320, to: 90, type: 'square', dur: 0.16, gain: 0.08 });
  }
  crack() { this.noise({ dur: 0.09, gain: 0.14, freq: 3400, to: 1600, q: 4 }); }
  shatter() {
    this.noise({ dur: 0.42, gain: 0.2, freq: 5200, to: 700, q: 0.7 });
    this.tone({ freq: 900, to: 200, type: 'triangle', dur: 0.26, gain: 0.07 });
  }
  swoosh() { this.noise({ dur: 0.18, gain: 0.09, freq: 900, to: 2600, q: 1.6, type: 'highpass' }); }
  hurt() {
    this.tone({ freq: 210, to: 55, type: 'square', dur: 0.34, gain: 0.2 });
    this.noise({ dur: 0.3, gain: 0.18, freq: 900, to: 120, q: 0.8 });
  }
  die() {
    this.tone({ freq: 330, to: 40, type: 'sawtooth', dur: 1.1, gain: 0.22 });
    this.tone({ freq: 165, to: 30, type: 'square', dur: 1.3, gain: 0.12 });
    this.noise({ dur: 0.9, gain: 0.14, freq: 1400, to: 90, q: 0.6 });
  }
  rage() {
    this.tone({ freq: 110, to: 880, type: 'sawtooth', dur: 0.5, gain: 0.2 });
    this.tone({ freq: 55, to: 440, type: 'square', dur: 0.6, gain: 0.12 });
    this.noise({ dur: 0.7, gain: 0.16, freq: 300, to: 5200, q: 0.8 });
  }
  rageReady() {
    [0, 7, 12].forEach((s, i) => setTimeout(() => this.tone({ freq: 330 * Math.pow(2, s / 12), type: 'square', dur: 0.18, gain: 0.1 }), i * 70));
  }
  biome() {
    this.tone({ freq: 220, to: 440, type: 'sine', dur: 0.7, gain: 0.12 });
    this.noise({ dur: 0.8, gain: 0.07, freq: 400, to: 2400, q: 0.7 });
  }
  uiTap() { this.tone({ freq: 620, to: 880, type: 'triangle', dur: 0.09, gain: 0.12 }); }

  // --- ambient bed -----------------------------------------------------
  setBiome(index) {
    this.scale = SCALES[index % SCALES.length];
    this.root = [55, 49, 58, 46][index % 4];
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.musicGain.gain.setTargetAtTime(0.5, this.t, 1.2);
    const beat = 0.42;
    this.timer = setInterval(() => {
      if (!this.enabled || !this.ctx) return;
      const s = this.step++;
      // Sparse arpeggio over a slow drone: atmosphere, not a melody to fight.
      if (s % 2 === 0) {
        const deg = this.scale[(s >> 1) % this.scale.length];
        const oct = 2 + (((s >> 1) % 7) > 4 ? 1 : 0);
        this.tone({
          freq: this.root * Math.pow(2, oct) * Math.pow(2, deg / 12),
          type: 'triangle', dur: beat * 1.6, gain: 0.05, dest: this.musicGain,
        });
      }
      if (s % 8 === 0) {
        this.tone({ freq: this.root, type: 'sawtooth', dur: beat * 8, gain: 0.035, dest: this.musicGain, detune: -7 });
        this.tone({ freq: this.root * 1.5, type: 'sine', dur: beat * 8, gain: 0.025, dest: this.musicGain, detune: 6 });
      }
    }, beat * 1000);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(0, this.t, 0.4);
  }
}

/** Adapter passed into Game so it can fire sounds + haptics without knowing about either. */
export function makeFx(audio, opts = {}) {
  const buzz = (pattern) => {
    if (opts.haptics?.() && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } }
  };
  return {
    fire: (r) => audio.fire(r),
    fizzle: () => audio.fizzle(),
    gem: (n) => audio.gem(n),
    heart: () => { audio.heart(); buzz(30); },
    kill: () => audio.kill(),
    crack: () => audio.crack(),
    shatter: () => { audio.shatter(); buzz(18); },
    swoosh: () => audio.swoosh(),
    hurt: () => { audio.hurt(); buzz([0, 45, 40, 45]); },
    die: () => { audio.die(); buzz([0, 90, 60, 160]); },
    rage: () => { audio.rage(); buzz([0, 60, 40, 120]); },
    rageReady: () => audio.rageReady(),
    biome: () => audio.biome(),
  };
}
