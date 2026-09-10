/**
 * Actors and collision maths. DOM-free so it can be exercised under node.
 */

import {
  DRAGON_R, GRAVITY, LIFT, VY_MAX_DOWN, VY_MAX_UP,
  EMBER_MAX, HEARTS_START,
} from './config.js';
import { clamp } from './rng.js';

// --- geometry ---------------------------------------------------------
export function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

function segDistSq(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : clamp((wx * vx + wy * vy) / len, 0, 1);
  const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
  return dx * dx + dy * dy;
}

export function circleTri(cx, cy, r, ax, ay, bx, by, ccx, ccy) {
  // Inside test (sign of the three cross products must agree).
  const d1 = (cx - bx) * (ay - by) - (ax - bx) * (cy - by);
  const d2 = (cx - ccx) * (by - ccy) - (bx - ccx) * (cy - ccy);
  const d3 = (cx - ax) * (ccy - ay) - (ccx - ax) * (cy - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  if (!(neg && pos)) return true;
  const rr = r * r;
  return segDistSq(cx, cy, ax, ay, bx, by) <= rr
    || segDistSq(cx, cy, bx, by, ccx, ccy) <= rr
    || segDistSq(cx, cy, ccx, ccy, ax, ay) <= rr;
}

export function circleCircle(ax, ay, ar, bx, by, br) {
  const dx = ax - bx, dy = ay - by, rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}

/** Triangle points of a spike, shrunk slightly so grazes feel fair. */
export function spikeTri(e, shrink = 4) {
  const hw = e.w / 2 - shrink;
  const apex = e.y + e.dir * (e.h - shrink);
  const base = e.y - e.dir * shrink;
  return [e.x - hw, base, e.x + hw, base, e.x, apex];
}

// --- dragon -----------------------------------------------------------
export class Dragon {
  constructor() { this.reset(0, 0); }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.vy = 0;
    this.r = DRAGON_R;
    this.tilt = 0;
    this.flapPhase = 0;
    this.flapPower = 0;
    this.hearts = HEARTS_START;
    this.ember = EMBER_MAX;
    this.rage = 0;
    this.rageTime = 0;
    this.invuln = 0;
    this.fireCd = 0;
    this.alive = true;
    this.tailPhase = 0;
    this.hurtFlash = 0;
  }

  get raging() { return this.rageTime > 0; }

  update(dt, holding, chill) {
    const g = GRAVITY * (1 - chill * 0.32);
    this.vy += (holding ? LIFT + g * 0.15 : g) * dt;
    this.vy = clamp(this.vy, -VY_MAX_UP, VY_MAX_DOWN);
    this.y += this.vy * dt;

    // Wings beat faster while climbing, ease into a glide while falling.
    const target = holding ? 1 : 0.18;
    this.flapPower += (target - this.flapPower) * Math.min(1, dt * 9);
    this.flapPhase += dt * (6.5 + this.flapPower * 9.5);
    this.tailPhase += dt * 4.2;
    this.tilt += (clamp(this.vy / 900, -0.55, 0.62) - this.tilt) * Math.min(1, dt * 9);

    if (this.invuln > 0) this.invuln -= dt;
    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.rageTime > 0) this.rageTime -= dt;
  }

  /** Muzzle position in world space, following the head as it tilts. */
  muzzle() {
    const c = Math.cos(this.tilt), s = Math.sin(this.tilt);
    const lx = 49, ly = -15;
    return { x: this.x + lx * c - ly * s, y: this.y + lx * s + ly * c };
  }
}

// --- particles --------------------------------------------------------
export class Particles {
  constructor(max = 420) {
    this.max = max;
    this.list = [];
  }
  clear() { this.list.length = 0; }

  spawn(p) {
    if (this.list.length >= this.max) this.list.shift();
    p.age = 0;
    this.list.push(p);
    return p;
  }

  burst(x, y, n, opts = {}) {
    const {
      speed = 140, spread = Math.PI * 2, dir = 0, life = 0.5, size = 5,
      color = '#c98bff', kind = 'spark', gravity = 0, drag = 2.4, scatter = 0.5,
    } = opts;
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const sp = speed * (1 - scatter + Math.random() * scatter * 2);
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: life * (0.65 + Math.random() * 0.7), maxLife: life,
        size: size * (0.6 + Math.random() * 0.8), color, kind, gravity, drag,
        rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 8,
      });
    }
  }

  update(dt, scroll) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.age += dt;
      if (p.age >= p.life) { l.splice(i, 1); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.x < scroll - 200) { l.splice(i, 1); }
    }
  }
}
