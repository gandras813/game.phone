/**
 * Game rules: pacing, collisions, scoring, life cycle.
 *
 * The renderer only reads state from here; audio/haptics arrive as an injected
 * `fx` object so this module stays testable and side-effect free.
 */

import * as C from './config.js';
import { clamp, lerp } from './rng.js';
import { World } from './world.js';
import { Dragon, Particles, circleRect, circleCircle, circleTri, spikeTri } from './entities.js';
import { save } from './storage.js';

const NOOP = new Proxy({}, { get: () => () => {} });

export class Game {
  constructor(fx = NOOP) {
    this.fx = fx;
    this.world = new World();
    this.dragon = new Dragon();
    this.particles = new Particles();
    this.fires = [];
    this.state = 'menu'; // menu | playing | dying | gameover | paused
    this.viewW = C.VIEW_W;
    this.viewH = C.VIEW_W * 1.8;
    this.camX = 0;
    this.trauma = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.flash = 0;
    this.freeze = 0;
    this.timeScale = 1;
    this.time = 0;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.gems = 0;
    this.kills = 0;
    this.distance = 0;
    this.speed = C.SPEED_MIN;
    this.biomeIndex = 0;
    this.biomeBlend = 0;
    this.banner = null;
    this.deathTimer = 0;
    this.result = null;
    this.hint = 0;
    this.dragon.reset(this.viewW * C.DRAGON_X, this.viewH / 2);
  }

  resize(viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
    this.world.viewH = viewH;
    if (this.state === 'menu') this.world.reset(viewH);
  }

  get multiplier() {
    return Math.min(C.COMBO_MAX_MULT, 1 + Math.floor(this.combo / C.COMBO_STEP));
  }

  get biome() { return C.BIOMES[this.biomeIndex % C.BIOMES.length]; }
  get nextBiome() { return C.BIOMES[(this.biomeIndex + 1) % C.BIOMES.length]; }

  /** 0 -> 1 as the run gets longer; drives speed, gap width and spawn mix. */
  get difficulty() { return clamp(this.distance / C.RAMP_DISTANCE, 0, 1); }

  start(seed) {
    this.world.reset(this.viewH, seed);
    this.camX = 0;
    this.dragon.reset(this.viewW * C.DRAGON_X, this.viewH / 2);
    this.particles.clear();
    this.fires.length = 0;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.gems = 0;
    this.kills = 0;
    this.distance = 0;
    this.speed = C.SPEED_MIN;
    this.biomeIndex = 0;
    this.biomeBlend = 0;
    this.trauma = 0;
    this.flash = 0;
    this.freeze = 0;
    this.timeScale = 1;
    this.deathTimer = 0;
    this.result = null;
    this.banner = { text: C.BIOMES[0].name, life: 2.4 };
    this.hint = save.get('seenTutorial') ? 0 : 4.5;
    this.state = 'playing';
    this.world.ensure(this.camX + this.viewW * 2, 0);
  }

  // --- input intents ---------------------------------------------------
  fire() {
    const d = this.dragon;
    if (this.state !== 'playing' || d.fireCd > 0) return;
    if (!d.raging && d.ember < C.EMBER_COST) {
      d.fireCd = 0.28;
      this.fx.fizzle();
      return;
    }
    if (!d.raging) d.ember -= C.EMBER_COST;
    d.fireCd = d.raging ? 0.07 : C.FIRE_COOLDOWN;
    const m = d.muzzle();
    const power = d.raging ? 2 : 1;
    this.fires.push({
      x: m.x, y: m.y,
      vy: Math.sin(d.tilt) * C.FIRE_SPEED * 0.5 + d.vy * 0.2,
      life: C.FIRE_LIFE, age: 0,
      r: d.raging ? 21 : 16,
      jitter: 0.78 + Math.random() * 0.5,
      seed: Math.random() * 6.28,
      power,
    });
    this.particles.burst(m.x, m.y, d.raging ? 8 : 5, {
      speed: 150, dir: d.tilt, spread: 1.1, life: 0.28, size: 7,
      color: C.DRAGON.flameHot, kind: 'flame', drag: 4,
    });
    this.trauma = Math.min(1, this.trauma + (d.raging ? 0.05 : 0.09));
    this.fx.fire(d.raging);
  }

  useRage() {
    const d = this.dragon;
    if (this.state !== 'playing' || d.raging || d.rage < C.RAGE_MAX) return;
    d.rage = 0;
    d.rageTime = C.RAGE_DURATION;
    this.trauma = 1;
    this.flash = 0.6;
    this.fx.rage();
    this.banner = { text: 'DRAGON RAGE', life: 1.5 };
  }

  // --- main loop -------------------------------------------------------
  update(rawDt, holding) {
    const dt = Math.min(rawDt, 1 / 20);
    this.time += dt;

    if (this.state === 'dying') {
      this.deathTimer += dt;
      this.timeScale = lerp(this.timeScale, 0.42, Math.min(1, dt * 3));
      if (this.deathTimer > 1.25) this.finish();
    } else if (this.state === 'playing') {
      this.timeScale = lerp(this.timeScale, 1, Math.min(1, dt * 6));
    }

    if (this.freeze > 0) {
      this.freeze -= dt;
      this.decayEffects(dt);
      return;
    }

    const sdt = dt * this.timeScale;
    if (this.state === 'playing') this.step(sdt, holding);
    else if (this.state === 'dying') this.stepDying(sdt);
    else if (this.state === 'menu' || this.state === 'gameover') this.stepIdle(sdt);

    this.particles.update(sdt, this.camX);
    this.decayEffects(dt);
  }

  decayEffects(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const t = this.trauma * this.trauma;
    this.shakeX = (Math.random() * 2 - 1) * 16 * t;
    this.shakeY = (Math.random() * 2 - 1) * 16 * t;
    this.flash = Math.max(0, this.flash - dt * 2.6);
    if (this.banner) { this.banner.life -= dt; if (this.banner.life <= 0) this.banner = null; }
    if (this.hint > 0) this.hint -= dt;
  }

  step(dt, holding) {
    const d = this.dragon;
    const diff = this.difficulty;
    this.speed = lerp(C.SPEED_MIN, C.SPEED_MAX, diff);

    this.camX += this.speed * dt;
    this.distance += this.speed * dt;
    d.x = this.camX + this.viewW * C.DRAGON_X + clamp(d.vy * 0.03, -14, 20);

    // Biome transitions
    const bi = Math.floor(this.distance / C.BIOME_LENGTH);
    if (bi !== this.biomeIndex) {
      this.biomeIndex = bi;
      this.banner = { text: this.biome.name, life: 2.4 };
      this.fx.biome();
    }
    this.biomeBlend = (this.distance % C.BIOME_LENGTH) / C.BIOME_LENGTH;

    d.update(dt, holding, this.biome.chill);
    if (d.raging) this.fire();
    if (!d.raging) d.ember = Math.min(C.EMBER_MAX, d.ember + C.EMBER_REGEN * dt);

    // Wing-beat dust
    if (holding && Math.sin(d.flapPhase) > 0.94) {
      this.particles.burst(d.x - 12, d.y + 10, 2, {
        speed: 60, dir: Math.PI * 0.6, spread: 1.4, life: 0.4, size: 4,
        color: this.biome.mote, kind: 'dust', drag: 3,
      });
    }
    if (d.raging) {
      this.particles.burst(d.x - 20, d.y, 2, {
        speed: 90, dir: Math.PI, spread: 1.6, life: 0.35, size: 8,
        color: C.DRAGON.flame, kind: 'flame', drag: 3,
      });
    }

    this.world.ensure(this.camX + this.viewW + 260, diff);
    this.world.prune(this.camX - 160);

    this.updateFires(dt);
    this.updateEntities(dt);
    this.collideTerrain();

    this.score += this.speed * dt * C.SCORE_PER_UNIT * this.multiplier;
  }

  /** Slow drifting flight behind the menu / results screens. */
  stepIdle(dt) {
    const d = this.dragon;
    if (this.state === 'gameover') { this.camX += 30 * dt; return; }
    this.speed = 96;
    this.camX += this.speed * dt;
    this.world.ensure(this.camX + this.viewW + 260, 0);
    this.world.prune(this.camX - 160);
    d.x = this.camX + this.viewW * C.DRAGON_X;
    const h = this.world.heightsAt(d.x);
    const mid = (h.c + h.f) / 2 + Math.sin(this.time * 0.9) * Math.min(90, (h.f - h.c) * 0.22);
    d.y += (mid - d.y) * Math.min(1, dt * 2.2);
    d.vy = 0;
    d.flapPhase += dt * 6.2;
    d.tailPhase += dt * 3.4;
    d.flapPower = 0.75;
    d.tilt = Math.sin(this.time * 0.9 + 1.57) * 0.1;
    d.ember = C.EMBER_MAX;
    for (const e of this.world.ents) if (e.kind === 'gem' || e.kind === 'heart') e.spin += dt * 2.2;
  }

  stepDying(dt) {
    const d = this.dragon;
    this.speed = Math.max(0, this.speed - 420 * dt);
    this.camX += this.speed * dt;
    d.vy = Math.min(C.VY_MAX_DOWN, d.vy + C.GRAVITY * 0.8 * dt);
    d.y += d.vy * dt;
    d.tilt += dt * 3.4;
    d.flapPhase += dt * 3;
    if (this.time % 0.1 < dt) {
      this.particles.burst(d.x, d.y, 3, {
        speed: 80, spread: 6.28, life: 0.6, size: 6,
        color: C.DRAGON.flame, kind: 'flame', drag: 2,
      });
    }
  }

  updateFires(dt) {
    const worldSpeed = this.speed + C.FIRE_SPEED;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const b = this.fires[i];
      b.age += dt;
      b.x += worldSpeed * dt;
      b.y += b.vy * dt;
      b.vy *= Math.exp(-1.5 * dt);
      if (b.age >= b.life) { this.fires.splice(i, 1); continue; }

      this.particles.burst(b.x, b.y, 1, {
        speed: 40, spread: 6.28, life: 0.3, size: b.r * 0.8,
        color: b.age < 0.12 ? C.DRAGON.flameHot : C.DRAGON.flame, kind: 'flame', drag: 5,
      });

      const h = this.world.heightsAt(b.x);
      if (b.y - b.r * 0.5 < h.c || b.y + b.r * 0.5 > h.f) {
        this.splash(b, b.y < h.c + 4 ? 1 : -1);
        this.fires.splice(i, 1);
        continue;
      }
      if (this.hitEntities(b)) this.fires.splice(i, 1);
    }
  }

  splash(b, dir) {
    this.particles.burst(b.x, b.y, 8, {
      speed: 130, dir: dir > 0 ? 0.4 : -0.4, spread: 2.4, life: 0.35,
      size: 6, color: C.DRAGON.flame, kind: 'flame', drag: 5,
    });
  }

  /** Returns true when the fireball is consumed. */
  hitEntities(b) {
    for (const e of this.world.ents) {
      if (e.dead) continue;
      if (e.x < b.x - 90 || e.x > b.x + 120) continue;

      if (e.kind === 'wisp' && circleCircle(b.x, b.y, b.r, e.x, e.y, e.r)) {
        this.killWisp(e);
        return b.power < 2;
      }
      if (e.kind === 'crystal' && circleRect(b.x, b.y, b.r, e.x - e.w / 2, e.y, e.w, e.h)) {
        e.hp -= b.power;
        e.flash = 1;
        this.fx.crack();
        if (e.hp <= 0) this.shatterCrystal(e);
        else this.particles.burst(b.x, b.y, 6, { speed: 120, spread: 6.28, life: 0.3, size: 5, color: this.biome.edge, kind: 'shard', drag: 4 });
        return true;
      }
      if (e.kind === 'gate' && e.open === 0 && circleCircle(b.x, b.y, b.r, e.x, e.y, e.r)) {
        e.hp -= b.power;
        e.flash = 1;
        this.fx.crack();
        if (e.hp <= 0) this.openGate(e);
        return true;
      }
      if (e.kind === 'spike' && b.power >= 2 && circleTri(b.x, b.y, b.r, ...spikeTri(e, 0))) {
        this.shatterSpike(e);
        return false;
      }
    }
    return false;
  }

  killWisp(e) {
    e.dead = true;
    this.kills++;
    this.addCombo();
    this.addScore(C.SCORE_KILL);
    this.addRage(C.RAGE_PER_KILL);
    this.particles.burst(e.x, e.y, 14, { speed: 190, spread: 6.28, life: 0.5, size: 6, color: C.DRAGON.flame, kind: 'flame', drag: 3 });
    this.particles.burst(e.x, e.y, 1, { speed: 0, life: 0.35, size: e.r * 2.4, color: C.DRAGON.flameHot, kind: 'ring', drag: 0 });
    this.trauma = Math.min(1, this.trauma + 0.16);
    this.freeze = 0.035;
    this.fx.kill();
  }

  shatterCrystal(e) {
    e.dead = true;
    this.addCombo();
    this.addScore(C.SCORE_SHATTER);
    this.addRage(C.RAGE_PER_SHATTER);
    this.particles.burst(e.x, e.y + e.h / 2, 18, { speed: 210, spread: 6.28, life: 0.7, size: 7, color: this.biome.edge, kind: 'shard', gravity: 500, drag: 1.2 });
    this.trauma = Math.min(1, this.trauma + 0.2);
    this.freeze = 0.04;
    this.fx.shatter();
  }

  shatterSpike(e) {
    e.dead = true;
    this.addScore(C.SCORE_SHATTER);
    this.particles.burst(e.x, e.y + e.dir * e.h * 0.5, 16, { speed: 200, spread: 6.28, life: 0.7, size: 8, color: this.biome.rock[0], kind: 'shard', gravity: 620, drag: 1.2 });
    this.trauma = Math.min(1, this.trauma + 0.18);
    this.fx.shatter();
  }

  openGate(e) {
    e.open = 0.001;
    this.addCombo();
    this.addScore(C.SCORE_SHATTER * 2);
    this.addRage(C.RAGE_PER_SHATTER * 2);
    this.particles.burst(e.x, e.y, 26, { speed: 260, spread: 6.28, life: 0.8, size: 8, color: this.biome.edge, kind: 'shard', gravity: 420, drag: 1.1 });
    this.particles.burst(e.x, e.y, 1, { speed: 0, life: 0.5, size: 90, color: C.DRAGON.flameHot, kind: 'ring', drag: 0 });
    this.trauma = 0.7;
    this.flash = 0.35;
    this.freeze = 0.06;
    this.fx.shatter();
  }

  updateEntities(dt) {
    const d = this.dragon;
    const diff = this.difficulty;

    for (const e of this.world.ents) {
      if (e.dead) continue;

      if (e.kind === 'wisp') {
        e.phase += dt * e.freq;
        e.baseY += e.drift * dt * 0.5;
        // Lazy pursuit: enough to feel alive, never enough to be unfair.
        if (Math.abs(e.x - d.x) < 260) e.baseY += clamp(d.y - e.baseY, -1, 1) * (14 + diff * 26) * dt;
        const h = this.world.heightsAt(e.x);
        e.baseY = clamp(e.baseY, h.c + e.r + 6, h.f - e.r - 6);
        e.y = e.baseY + Math.sin(e.phase * 2.4) * e.amp * 0.5;
      } else if (e.kind === 'gem' || e.kind === 'heart') {
        e.spin += dt * 2.2;
        // Gentle magnetism keeps thumb-flying satisfying on a small screen.
        const dx = d.x - e.x, dy = d.y - e.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 78) {
          const pull = (1 - dist / 78) * 260 * dt;
          e.x += (dx / (dist || 1)) * pull;
          e.y += (dy / (dist || 1)) * pull;
        }
      } else if (e.kind === 'gate' && e.open > 0) {
        e.open = Math.min(1, e.open + dt * 3);
        if (e.open >= 1) e.dead = true;
      }
      if (e.flash > 0) e.flash -= dt * 4;

      if (e.nm !== undefined && !e.nm && Math.abs(e.x - d.x) < 140) {
        const gap = this.hazardClearance(e, d);
        e.minD = e.minD === undefined ? gap : Math.min(e.minD, gap);
      }
      this.collideDragon(e);
      this.trackNearMiss(e);
    }
  }

  collideDragon(e) {
    const d = this.dragon;
    if (e.dead || this.state !== 'playing') return;
    if (Math.abs(e.x - d.x) > 130) return;

    switch (e.kind) {
      case 'gem':
        if (circleCircle(d.x, d.y, d.r + 8, e.x, e.y, e.r)) {
          e.dead = true;
          this.gems++;
          this.addCombo();
          this.addScore(C.SCORE_GEM);
          this.addRage(C.RAGE_PER_GEM);
          d.ember = Math.min(C.EMBER_MAX, d.ember + 16);
          this.particles.burst(e.x, e.y, 10, { speed: 150, spread: 6.28, life: 0.45, size: 5, color: this.biome.mote, kind: 'spark', drag: 3 });
          this.fx.gem(Math.min(8, 1 + Math.floor(this.combo / 4)));
        }
        break;
      case 'heart':
        if (circleCircle(d.x, d.y, d.r + 10, e.x, e.y, e.r)) {
          e.dead = true;
          d.hearts = Math.min(C.HEARTS_MAX, d.hearts + 1);
          this.flash = 0.3;
          this.particles.burst(e.x, e.y, 16, { speed: 170, spread: 6.28, life: 0.6, size: 6, color: '#ff86b0', kind: 'spark', drag: 2.6 });
          this.fx.heart();
        }
        break;
      case 'wisp':
        if (circleCircle(d.x, d.y, d.r, e.x, e.y, e.r)) {
          if (d.raging) this.killWisp(e);
          else if (d.invuln > 0) e.dead = true;
          else { this.hurt('wisp'); e.dead = true; this.particles.burst(e.x, e.y, 10, { speed: 160, spread: 6.28, life: 0.4, size: 6, color: C.DRAGON.flame, kind: 'flame', drag: 3 }); }
        }
        break;
      case 'crystal':
        if (circleRect(d.x, d.y, d.r, e.x - e.w / 2, e.y, e.w, e.h)) {
          if (d.raging) this.shatterCrystal(e);
          else if (d.invuln > 0) this.shatterCrystal(e);
          else { this.hurt('crystal'); this.shatterCrystal(e); }
        }
        break;
      case 'spike':
        if (circleTri(d.x, d.y, d.r, ...spikeTri(e))) {
          if (d.raging || d.invuln > 0) this.shatterSpike(e);
          else { this.hurt('spike'); this.shatterSpike(e); }
        }
        break;
      case 'gate': {
        if (e.open > 0) break;
        const armW = 30;
        const hitTop = circleRect(d.x, d.y, d.r, e.x - armW / 2, e.c, armW, e.y - e.r - e.c);
        const hitBot = circleRect(d.x, d.y, d.r, e.x - armW / 2, e.y + e.r, armW, e.f - (e.y + e.r));
        const hitCore = circleCircle(d.x, d.y, d.r, e.x, e.y, e.r);
        if (hitTop || hitBot || hitCore) {
          if (d.raging || d.invuln > 0) this.openGate(e);
          else { this.hurt('gate'); this.openGate(e); }
        }
        break;
      }
    }
  }

  /** Approximate surface-to-surface clearance between the dragon and a hazard. */
  hazardClearance(e, d) {
    if (e.kind === 'wisp') return Math.hypot(e.x - d.x, e.y - d.y) - e.r - d.r;
    if (e.kind === 'gate') return Math.abs(e.x - d.x) - 15 - d.r;
    const hw = e.w / 2;
    const top = e.kind === 'spike' ? Math.min(e.y, e.y + e.dir * e.h) : e.y;
    const h = e.kind === 'spike' ? e.h : e.h;
    const dx = Math.max(0, Math.abs(e.x - d.x) - hw);
    const dy = Math.max(0, Math.abs(d.y - (top + h / 2)) - h / 2);
    return Math.hypot(dx, dy) - d.r;
  }

  trackNearMiss(e) {
    if (this.state !== 'playing') return;
    if (e.nm === undefined || e.nm || e.dead) return;
    const d = this.dragon;
    if (e.x > d.x - 6) return; // only score it once the hazard is behind us
    const half = e.kind === 'spike' || e.kind === 'crystal' ? e.w / 2 : e.r;
    if (e.x + half > d.x - d.r) return;
    e.nm = true;
    if (e.minD !== undefined && e.minD < 30) {
      this.addScore(C.SCORE_NEAR_MISS);
      this.addRage(C.RAGE_PER_NEAR_MISS);
      this.fx.swoosh();
      this.particles.burst(d.x - 26, d.y, 4, { speed: 120, dir: Math.PI, spread: 1.2, life: 0.3, size: 4, color: '#ffffff', kind: 'dust', drag: 4 });
    }
  }

  collideTerrain() {
    const d = this.dragon;
    if (this.state !== 'playing') return;
    let c = -Infinity, f = Infinity;
    for (const dx of [-10, 0, 10]) {
      const h = this.world.heightsAt(d.x + dx);
      c = Math.max(c, h.c);
      f = Math.min(f, h.f);
    }
    // Log the tightest squeeze for near-miss credit on the walls themselves.
    const clearance = Math.min(d.y - d.r - c, f - (d.y + d.r));
    if (clearance < 14 && clearance > 0 && this.time - (this._lastGraze || -9) > 0.6) {
      this._lastGraze = this.time;
      this.addRage(C.RAGE_PER_NEAR_MISS * 0.6);
      this.particles.burst(d.x, clearance === d.y - d.r - c ? d.y - d.r : d.y + d.r, 3, {
        speed: 90, dir: Math.PI, spread: 1.4, life: 0.25, size: 3, color: '#ffffff', kind: 'dust', drag: 4,
      });
    }

    let hit = 0;
    if (d.y - d.r < c) { d.y = c + d.r; if (d.vy < 0) d.vy = 60; hit = 1; }
    else if (d.y + d.r > f) { d.y = f - d.r; if (d.vy > 0) d.vy = -60; hit = -1; }
    if (hit && !d.raging && d.invuln <= 0) {
      this.hurt(hit > 0 ? 'ceiling' : 'floor');
      this.particles.burst(d.x, d.y + hit * -d.r, 12, {
        speed: 170, dir: hit > 0 ? 0.6 : -0.6, spread: 2.2, life: 0.5, size: 6,
        color: this.biome.rock[0], kind: 'shard', gravity: 420, drag: 1.6,
      });
    } else if (hit && d.raging) {
      this.particles.burst(d.x, d.y + hit * -d.r, 6, {
        speed: 200, dir: hit > 0 ? 0.6 : -0.6, spread: 2, life: 0.4, size: 7,
        color: C.DRAGON.flame, kind: 'flame', drag: 2,
      });
      this.trauma = Math.min(1, this.trauma + 0.1);
    }
  }

  // --- scoring ---------------------------------------------------------
  addScore(base) { this.score += base * this.multiplier; }
  addCombo() {
    this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
  }
  addRage(v) {
    const d = this.dragon;
    if (d.raging) return;
    const was = d.rage;
    d.rage = Math.min(C.RAGE_MAX, d.rage + v);
    if (was < C.RAGE_MAX && d.rage >= C.RAGE_MAX) {
      this.fx.rageReady();
      this.banner = { text: 'RAGE READY', life: 1.4 };
    }
  }

  hurt(cause = 'rock') {
    const d = this.dragon;
    if (d.invuln > 0 || d.raging) return;
    this.lastCause = cause;
    d.hearts--;
    d.invuln = C.INVULN_TIME;
    d.hurtFlash = 0.4;
    this.combo = 0;
    this.trauma = 1;
    this.flash = 0.5;
    this.freeze = 0.09;
    this.fx.hurt(d.hearts);
    if (d.hearts <= 0) this.die();
  }

  die() {
    this.state = 'dying';
    this.deathTimer = 0;
    this.dragon.alive = false;
    this.dragon.vy = -260;
    this.trauma = 1;
    this.flash = 0.7;
    this.fx.die();
  }

  finish() {
    this.state = 'gameover';
    const score = Math.floor(this.score);
    const prev = save.get('best') || 0;
    this.result = {
      score,
      best: Math.max(prev, score),
      newBest: score > prev,
      distance: Math.floor(this.distance / 10),
      gems: this.gems,
      kills: this.kills,
      combo: this.bestCombo,
      cause: this.lastCause,
    };
    save.patch({
      best: this.result.best,
      bestDistance: Math.max(save.get('bestDistance') || 0, this.result.distance),
      totalGems: (save.get('totalGems') || 0) + this.gems,
      runs: (save.get('runs') || 0) + 1,
      seenTutorial: true,
    });
  }
}
