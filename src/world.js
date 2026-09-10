/**
 * Procedural cave director.
 *
 * The world is an endless left-to-right cave described by terrain samples every
 * STEP units: `c` is how far the ceiling hangs down, `f` is where the floor
 * starts. Between them the director drops hazards and pickups.
 *
 * The design rule that makes the run interesting: every section asks a
 * different question. Some hazards *must* be dodged (spikes, terrain), some
 * *must* be burned (rune gates), and some can be either (crystals, wisps) at
 * the price of ember you might want later. Fire is scarce, so "burn or squeeze"
 * is a real decision rather than a reflex.
 *
 * This module is deliberately DOM-free so it can be unit tested under node.
 */

import { STEP, WALL_MARGIN } from './config.js';
import { makeRng, clamp, lerp, rand, randInt } from './rng.js';

let nextId = 1;

/** Section recipes. `weight(d)` lets sections fade in as difficulty rises. */
const SECTIONS = [
  { type: 'open', weight: () => 1.0 },
  { type: 'narrow', weight: (d) => 0.5 + d * 0.9 },
  { type: 'pillars', weight: (d) => 0.25 + d * 0.9 },
  { type: 'crystals', weight: (d) => 0.35 + d * 0.7 },
  { type: 'swarm', weight: (d) => 0.2 + d * 0.8 },
  { type: 'gate', weight: (d) => (d < 0.06 ? 0 : 0.3 + d * 0.5) },
  { type: 'treasure', weight: () => 0.45 },
];

export class World {
  constructor(seed) {
    this.reset(800, seed);
  }

  reset(viewH, seed = (Math.random() * 1e9) >>> 0) {
    this.rng = makeRng(seed);
    this.seed = seed;
    this.viewH = viewH;
    this.samples = []; // {x, c, f}
    this.ents = [];
    this.genX = -STEP * 4;
    this.center = viewH / 2;
    this.gap = Math.min(viewH - WALL_MARGIN * 2, 430);
    this.targetCenter = this.center;
    this.targetGap = this.gap;
    this.wave = 0;
    this.wavePhase = 0;
    this.waveFreq = 0.008;
    this.section = { type: 'open', left: 1400, tick: 0 };
    this.lastGateX = 0;
    // Prime a calm opening stretch so the first seconds are readable.
    const openC = Math.max(WALL_MARGIN, (viewH - this.gap) / 2);
    for (let i = 0; i < 6; i++) this.samples.push({ x: this.genX + i * STEP, c: openC, f: openC + this.gap });
    this.genX += 6 * STEP;
  }

  /** Difficulty-scaled bounds for the vertical opening. */
  gapRange(d) {
    const maxGap = Math.min(this.viewH - WALL_MARGIN * 2, lerp(430, 300, d));
    const minGap = Math.max(160, Math.min(maxGap, lerp(330, 205, d)));
    return [minGap, maxGap];
  }

  chooseSection(d) {
    const total = SECTIONS.reduce((s, x) => s + Math.max(0, x.weight(d)), 0);
    let r = this.rng() * total;
    let chosen = SECTIONS[0];
    for (const s of SECTIONS) {
      r -= Math.max(0, s.weight(d));
      if (r <= 0) { chosen = s; break; }
    }
    // Never chain two identical sections; variety is the point.
    if (chosen.type === this.section.type) {
      const alt = SECTIONS[(SECTIONS.indexOf(chosen) + 1 + randInt(this.rng, 0, 2)) % SECTIONS.length];
      chosen = alt;
    }
    return chosen.type;
  }

  beginSection(d) {
    const type = this.chooseSection(d);
    const [minGap, maxGap] = this.gapRange(d);
    const s = { type, left: 0, tick: 0, phase: 0 };

    switch (type) {
      case 'open':
        s.left = rand(this.rng, 460, 760);
        this.targetGap = maxGap;
        this.wave = rand(this.rng, 10, 34);
        break;
      case 'narrow':
        s.left = rand(this.rng, 420, 700);
        this.targetGap = lerp(minGap, maxGap, 0.12);
        this.wave = rand(this.rng, 16, 46) * (0.6 + d * 0.7);
        break;
      case 'pillars':
        s.left = rand(this.rng, 520, 820);
        this.targetGap = lerp(minGap, maxGap, 0.75);
        this.wave = rand(this.rng, 6, 20);
        s.every = randInt(this.rng, 6, 8);
        s.fromFloor = this.rng() < 0.5;
        break;
      case 'crystals':
        s.left = rand(this.rng, 460, 700);
        this.targetGap = lerp(minGap, maxGap, 0.62);
        this.wave = rand(this.rng, 6, 22);
        s.every = randInt(this.rng, 5, 8);
        break;
      case 'swarm':
        s.left = rand(this.rng, 460, 680);
        this.targetGap = maxGap * 0.94;
        this.wave = rand(this.rng, 8, 26);
        s.formation = randInt(this.rng, 0, 2);
        break;
      case 'gate':
        s.left = rand(this.rng, 420, 560);
        this.targetGap = lerp(minGap, maxGap, 0.85);
        this.wave = 6;
        s.placed = false;
        break;
      case 'treasure':
        s.left = rand(this.rng, 400, 620);
        this.targetGap = lerp(minGap, maxGap, 0.45);
        this.wave = rand(this.rng, 20, 50);
        s.arc = this.rng() < 0.5 ? 1 : -1;
        break;
    }

    this.waveFreq = rand(this.rng, 0.005, 0.011);
    const drift = rand(this.rng, -0.3, 0.3) * this.viewH;
    this.targetCenter = clamp(this.center + drift, this.targetGap / 2 + WALL_MARGIN, this.viewH - this.targetGap / 2 - WALL_MARGIN);
    this.section = s;
  }

  /** Advance generation by one terrain sample. */
  step(d) {
    if (this.section.left <= 0) this.beginSection(d);
    const s = this.section;

    // Ease terrain toward the section's targets so walls never snap.
    const ease = 0.085 + d * 0.05;
    this.gap += (this.targetGap - this.gap) * ease;
    this.center += (this.targetCenter - this.center) * ease * 0.8;
    this.wavePhase += this.waveFreq * STEP;

    const minOpen = Math.min(150, this.viewH - WALL_MARGIN * 2);
    const maxOpen = this.viewH - WALL_MARGIN * 2;
    const gap = clamp(this.gap, minOpen, maxOpen);

    // One shared wobble snakes the tunnel; two small independent ones roughen
    // the rock so ceiling and floor never look like parallel copies.
    const p = this.wavePhase;
    const snake = Math.sin(p) * this.wave + Math.sin(p * 2.3 + 1.7) * this.wave * 0.3;
    const bumpC = Math.sin(p * 3.1 + 0.9) * this.wave * 0.22 + Math.sin(p * 5.7) * 4;
    const bumpF = Math.sin(p * 2.7 + 4.2) * this.wave * 0.22 + Math.sin(p * 6.3 + 2) * 4;

    const center = clamp(this.center + snake, WALL_MARGIN + gap / 2, this.viewH - WALL_MARGIN - gap / 2);
    let c = clamp(center - gap / 2 + bumpC, WALL_MARGIN, this.viewH - WALL_MARGIN - minOpen);
    let f = clamp(center + gap / 2 + bumpF, c + minOpen, this.viewH - WALL_MARGIN);

    const x = this.genX;
    this.samples.push({ x, c, f });
    this.spawnFor(s, x, c, f, d);

    this.genX += STEP;
    s.left -= STEP;
    s.tick++;
  }

  spawnFor(s, x, c, f, d) {
    const mid = (c + f) / 2;
    const gap = f - c;
    const R = this.rng;

    switch (s.type) {
      case 'open':
        if (s.tick % 4 === 2 && R() < 0.5) this.addGem(x, mid + Math.sin(s.tick * 0.6) * gap * 0.28);
        if (s.tick === 6 && R() < 0.35 + d * 0.3) this.addWisp(x, mid, gap * 0.3);
        break;

      case 'narrow':
        if (s.tick % 5 === 3) this.addGem(x, mid + rand(R, -0.2, 0.2) * gap);
        break;

      case 'pillars': {
        if (s.tick % s.every === 0 && s.tick > 1) {
          if (R() < 0.7) s.fromFloor = !s.fromFloor; // usually alternate, not always
          const len = clamp(gap * rand(R, 0.28, 0.44), 40, gap - 140);
          this.addSpike(x, s.fromFloor ? f : c, len, s.fromFloor ? -1 : 1);
          this.addGem(x + STEP * 2, s.fromFloor ? c + gap * 0.3 : f - gap * 0.3);
        }
        break;
      }

      case 'crystals': {
        if (s.tick % s.every === 0 && s.tick > 1) {
          const fromFloor = R() < 0.5;
          const h = clamp(gap * rand(R, 0.3, 0.46), 46, gap - 130);
          this.addCrystal(x, fromFloor ? f - h : c, h, fromFloor ? -1 : 1);
        }
        break;
      }

      case 'swarm': {
        if (s.tick === 4) {
          const n = 3 + Math.round(d * 3);
          for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0.5 : i / (n - 1);
            let y = mid + (t - 0.5) * gap * 0.62;
            if (s.formation === 1) y = mid + Math.sin(t * Math.PI) * gap * 0.3 - gap * 0.15;
            this.addWisp(x + i * STEP * 1.6, y, gap * 0.18, i * 0.7);
          }
        }
        break;
      }

      case 'gate': {
        // Gems on the approach guarantee enough ember to actually open it.
        if (s.tick === 1 || s.tick === 3) this.addGem(x, mid + (s.tick === 1 ? -1 : 1) * gap * 0.16);
        if (!s.placed && s.tick === 6) {
          s.placed = true;
          this.addGate(x, c, f);
        }
        break;
      }

      case 'treasure': {
        if (s.tick % 2 === 1 && s.tick > 2) {
          const t = (s.tick / 2) * 0.45;
          this.addGem(x, mid + Math.sin(t) * gap * 0.3 * s.arc);
        }
        if (s.tick === 3 && R() < 0.16) this.addHeart(x, mid);
        break;
      }
    }
  }

  // --- entity factories -------------------------------------------------
  addGem(x, y) {
    this.ents.push({ id: nextId++, kind: 'gem', x, y, r: 13, spin: this.rng() * 6.28, dead: false });
  }
  addHeart(x, y) {
    this.ents.push({ id: nextId++, kind: 'heart', x, y, r: 16, spin: 0, dead: false });
  }
  addWisp(x, y, amp, phase = 0) {
    this.ents.push({
      id: nextId++, kind: 'wisp', x, y, baseY: y, r: 15, hp: 1,
      amp, freq: rand(this.rng, 1.1, 2.0), phase: phase + this.rng() * 6.28,
      drift: rand(this.rng, -18, 18), dead: false, nm: false,
    });
  }
  addSpike(x, yBase, len, dir) {
    // dir -1: grows up from the floor. dir +1: hangs down from the ceiling.
    this.ents.push({
      id: nextId++, kind: 'spike', x, y: yBase, w: rand(this.rng, 34, 46), h: len, dir,
      dead: false, nm: false,
    });
  }
  addCrystal(x, y, h, dir) {
    this.ents.push({
      id: nextId++, kind: 'crystal', x, y, w: rand(this.rng, 30, 40), h, dir,
      hp: 2, flash: 0, dead: false, nm: false,
    });
  }
  addGate(x, c, f) {
    const coreY = (c + f) / 2;
    this.ents.push({
      id: nextId++, kind: 'gate', x, y: coreY, c, f, r: 26, hp: 3,
      open: 0, flash: 0, dead: false, nm: false,
    });
    this.lastGateX = x;
  }

  // --- streaming --------------------------------------------------------
  ensure(untilX, d) {
    let guard = 0;
    while (this.genX < untilX && guard++ < 4000) this.step(d);
  }

  prune(beforeX) {
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].x < beforeX) drop++;
    if (drop > 0) this.samples.splice(0, drop);
    for (let i = this.ents.length - 1; i >= 0; i--) {
      const e = this.ents[i];
      if (e.dead || e.x < beforeX - 120) this.ents.splice(i, 1);
    }
  }

  /** Linearly interpolated ceiling/floor at an arbitrary world x. */
  heightsAt(x) {
    const s = this.samples;
    if (s.length === 0) return { c: 0, f: this.viewH };
    const i = Math.floor((x - s[0].x) / STEP);
    if (i < 0) return { c: s[0].c, f: s[0].f };
    if (i >= s.length - 1) { const l = s[s.length - 1]; return { c: l.c, f: l.f }; }
    const a = s[i], b = s[i + 1];
    const t = clamp((x - a.x) / STEP, 0, 1);
    return { c: lerp(a.c, b.c, t), f: lerp(a.f, b.f, t) };
  }
}
