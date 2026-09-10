/**
 * All drawing. The renderer never mutates game state; it reads it.
 *
 * Two coordinate spaces are used:
 *   world space  - what the simulation uses; mapped via camera + scale
 *   screen space - CSS pixels, used for the HUD so text stays crisp
 */

import * as C from './config.js';
import { clamp, lerp, hashNoise } from './rng.js';
import { spikeTri } from './entities.js';

// --- colour helpers ---------------------------------------------------
/** Accepts #rgb, #rrggbb and rgb()/rgba() so mixed colours can be re-mixed. */
function parseColor(c) {
  if (c[0] === '#') {
    const n = parseInt(c.slice(1), 16);
    return c.length >= 7
      ? [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      : [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17];
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const p = m[1].split(',');
    return [parseFloat(p[0]) || 0, parseFloat(p[1]) || 0, parseFloat(p[2]) || 0];
  }
  return [255, 0, 255]; // unmistakable fallback
}
export function mix(a, b, t) {
  const A = parseColor(a), B = parseColor(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}
export function withAlpha(c, a) {
  const A = parseColor(c);
  return `rgba(${Math.round(A[0])},${Math.round(A[1])},${Math.round(A[2])},${a})`;
}

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 128px radial falloff used as a stamp for every dynamic light. */
function makeLightSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.34, 'rgba(0,0,0,0.94)');
  g.addColorStop(0.68, 'rgba(0,0,0,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return c;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.dpr = 1;
    this.cssW = 0;
    this.cssH = 0;
    this.scale = 1;
    this.viewH = 800;
    this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
    this.motes = [];
    this.quality = 1;
    this.hintText = 'HOLD TO FLY   ·   TAP FIRE TO BURN';
  }

  resize(cssW, cssH, dpr, safe) {
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    this.safe = safe;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.light.width = Math.max(1, Math.round(cssW * 0.5));
    this.light.height = Math.max(1, Math.round(cssH * 0.5));

    const ratio = clamp(cssH / cssW, C.MIN_RATIO, C.MAX_RATIO);
    this.viewH = C.VIEW_W * ratio;
    this.scale = (cssW * dpr) / C.VIEW_W;
    // Vertical letterbox correction when the window is outside the clamp range.
    this.offsetY = ((cssH * dpr) - this.viewH * this.scale) / 2;

    if (!this.lightSprite) this.lightSprite = makeLightSprite();

    this.motes = [];
    for (let i = 0; i < 34; i++) {
      this.motes.push({
        x: Math.random() * C.VIEW_W, y: Math.random() * this.viewH,
        z: 0.2 + Math.random() * 0.8, r: 1 + Math.random() * 2.6,
        ph: Math.random() * 6.28,
      });
    }
    return this.viewH;
  }

  /** Palette for the current biome, cross-faded into the next near the border. */
  palette(game) {
    const a = game.biome, b = game.nextBiome;
    const t = clamp((game.biomeBlend - 0.86) / 0.14, 0, 1);
    return {
      sky0: mix(a.sky[0], b.sky[0], t),
      sky1: mix(a.sky[1], b.sky[1], t),
      rock0: mix(a.rock[0], b.rock[0], t),
      rock1: mix(a.rock[1], b.rock[1], t),
      edge: mix(a.edge, b.edge, t),
      glow: mix(a.glow, b.glow, t),
      mote: mix(a.mote, b.mote, t),
      dark: lerp(a.dark, b.dark, t),
      edgeHex: t < 0.5 ? a.edge : b.edge,
    };
  }

  draw(game) {
    const ctx = this.ctx;
    const pal = this.palette(game);
    const W = this.canvas.width, H = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = pal.sky1;
    ctx.fillRect(0, 0, W, H);

    // World transform: world units -> device pixels, with camera + shake.
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, this.offsetY);
    ctx.translate(-game.camX + game.shakeX * 0.4, game.shakeY * 0.4);

    this.drawSky(ctx, game, pal);
    this.drawParallax(ctx, game, pal);
    this.drawMotes(ctx, game, pal);
    this.drawTerrain(ctx, game, pal);
    this.drawEntities(ctx, game, pal);
    this.drawFire(ctx, game);
    this.drawParticles(ctx, game);
    this.drawDragon(ctx, game, pal);
    this.drawLighting(ctx, game, pal);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawVignette(ctx, game, pal);
    if (game.state === 'playing' || game.state === 'dying') this.drawHud(ctx, game, pal);
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,240,255,${game.flash * 0.5})`;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
  }

  drawSky(ctx, game, pal) {
    const x0 = game.camX - 40, w = C.VIEW_W + 120;
    const g = ctx.createLinearGradient(0, 0, 0, this.viewH);
    g.addColorStop(0, pal.sky0);
    g.addColorStop(1, pal.sky1);
    ctx.fillStyle = g;
    ctx.fillRect(x0, -80, w, this.viewH + 200);
  }

  /** Layered rock silhouettes; deterministic so nothing needs storing. */
  drawParallax(ctx, game, pal) {
    const layers = [
      { p: 0.22, amp: 0.13, t: 0.16, freq: 0.0022 },
      { p: 0.42, amp: 0.10, t: 0.30, freq: 0.0036 },
      { p: 0.64, amp: 0.075, t: 0.46, freq: 0.0058 },
    ];
    const x0 = game.camX - 40, x1 = game.camX + C.VIEW_W + 60;
    for (const L of layers) {
      const col = mix(pal.sky1, pal.rock1, L.t);
      ctx.fillStyle = col;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        const base = side < 0 ? this.viewH * 0.30 : this.viewH * 0.70;
        ctx.moveTo(x0, side < 0 ? -60 : this.viewH + 60);
        for (let x = x0; x <= x1; x += 26) {
          const wx = x * L.p;
          const n = Math.sin(wx * L.freq) * 0.6
            + Math.sin(wx * L.freq * 2.7 + 1.3) * 0.28
            + Math.sin(wx * L.freq * 6.1 + 2.6) * 0.12;
          ctx.lineTo(x, base + n * this.viewH * L.amp * side * -1);
        }
        ctx.lineTo(x1, side < 0 ? -60 : this.viewH + 60);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  drawMotes(ctx, game, pal) {
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const drift = (game.camX * (0.12 + m.z * 0.3)) % (C.VIEW_W + 60);
      let x = game.camX + ((m.x - drift) % (C.VIEW_W + 60) + C.VIEW_W + 60) % (C.VIEW_W + 60) - 30;
      const y = m.y + Math.sin(game.time * 0.6 + m.ph) * 14;
      const a = 0.12 + 0.22 * m.z * (0.6 + 0.4 * Math.sin(game.time * 1.7 + m.ph));
      ctx.fillStyle = withAlpha(pal.edgeHex, a);
      ctx.beginPath();
      ctx.arc(x, y, m.r * m.z * 1.6, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  terrainPath(ctx, samples, key, outer) {
    ctx.beginPath();
    const first = samples[0], last = samples[samples.length - 1];
    ctx.moveTo(first.x, outer);
    ctx.lineTo(first.x, first[key]);
    for (let i = 1; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      ctx.quadraticCurveTo(a.x, a[key], (a.x + b.x) / 2, (a[key] + b[key]) / 2);
    }
    ctx.lineTo(last.x, last[key]);
    ctx.lineTo(last.x, outer);
    ctx.closePath();
  }

  drawTerrain(ctx, game, pal) {
    const s = game.world.samples;
    if (s.length < 3) return;

    const g = ctx.createLinearGradient(0, 0, 0, this.viewH);
    g.addColorStop(0, pal.rock0);
    g.addColorStop(0.5, pal.rock1);
    g.addColorStop(1, pal.rock0);

    for (const [key, outer, dir] of [['c', -140, 1], ['f', this.viewH + 140, -1]]) {
      this.terrainPath(ctx, s, key, outer);
      ctx.fillStyle = g;
      ctx.fill();

      // Glowing rim: a wide soft pass under a thin bright one.
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = withAlpha(pal.edgeHex, 0.16);
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.strokeStyle = withAlpha(pal.edgeHex, 0.85);
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
      // (path is reused below for the strata clip)

      // Strata inside the rock for depth.
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = withAlpha(pal.edgeHex, 0.07);
      ctx.lineWidth = 2;
      for (const off of [16, 34, 60]) {
        ctx.beginPath();
        for (let i = 0; i < s.length; i++) {
          const y = s[i][key] - dir * off;
          if (i === 0) ctx.moveTo(s[i].x, y); else ctx.lineTo(s[i].x, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // Wall crystals: cheap deterministic decoration that sells the biome.
      for (let i = 1; i < s.length; i += 2) {
        const n = hashNoise(s[i].x * 0.017, dir);
        if (n < 0.72) continue;
        const len = 10 + n * 26;
        const w = 4 + n * 6;
        const x = s[i].x, y = s[i][key];
        ctx.fillStyle = withAlpha(pal.edgeHex, 0.28 + n * 0.3);
        ctx.beginPath();
        ctx.moveTo(x - w, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + (n - 0.5) * 10, y - dir * len);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /**
   * Re-stroke the cave edges after the fog pass. In the dark biomes the rock
   * seams read as glowing veins, which keeps the walls flyable without
   * giving away what is waiting beyond the lamplight.
   */
  drawTerrainVeins(ctx, game, pal) {
    const s = game.world.samples;
    if (s.length < 3) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    for (const [key, outer] of [['c', -140], ['f', this.viewH + 140]]) {
      this.terrainPath(ctx, s, key, outer);
      ctx.strokeStyle = withAlpha(pal.edgeHex, 0.10 * pal.dark);
      ctx.lineWidth = 14;
      ctx.stroke();
      ctx.strokeStyle = withAlpha(pal.edgeHex, 0.55 * pal.dark);
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawEntities(ctx, game, pal) {
    const t = game.time;
    for (const e of game.world.ents) {
      if (e.dead) continue;
      if (e.x < game.camX - 90 || e.x > game.camX + C.VIEW_W + 90) continue;
      switch (e.kind) {
        case 'gem': this.drawGem(ctx, e, pal, t); break;
        case 'heart': this.drawHeart(ctx, e, t); break;
        case 'wisp': this.drawWisp(ctx, e, t); break;
        case 'spike': this.drawSpike(ctx, e, pal); break;
        case 'crystal': this.drawCrystal(ctx, e, pal, t); break;
        case 'gate': this.drawGate(ctx, e, pal, t); break;
      }
    }
  }

  drawGem(ctx, e, pal, t) {
    const s = 1 + Math.sin(t * 3 + e.spin) * 0.06;
    const sq = Math.abs(Math.cos(e.spin)) * 0.75 + 0.25; // fake 3D spin
    ctx.save();
    ctx.translate(e.x, e.y + Math.sin(t * 2 + e.spin) * 3);
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 1, 0, 0, e.r * 2.4);
    halo.addColorStop(0, withAlpha(pal.edgeHex, 0.5));
    halo.addColorStop(0.45, withAlpha(pal.edgeHex, 0.16));
    halo.addColorStop(1, withAlpha(pal.edgeHex, 0));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, e.r * 2.4, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.scale(sq * s, s);
    ctx.beginPath();
    ctx.moveTo(0, -e.r);
    ctx.lineTo(e.r * 0.82, -e.r * 0.22);
    ctx.lineTo(0, e.r);
    ctx.lineTo(-e.r * 0.82, -e.r * 0.22);
    ctx.closePath();
    const g = ctx.createLinearGradient(-e.r, -e.r, e.r, e.r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, pal.mote);
    g.addColorStop(1, pal.edge);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.82, -e.r * 0.22);
    ctx.lineTo(e.r * 0.82, -e.r * 0.22);
    ctx.moveTo(0, -e.r); ctx.lineTo(0, e.r);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
  }

  drawHeart(ctx, e, t) {
    const p = 1 + Math.sin(t * 5) * 0.09;
    ctx.save();
    ctx.translate(e.x, e.y + Math.sin(t * 2) * 3);
    ctx.scale(p, p);
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 1, 0, 0, e.r * 2.6);
    halo.addColorStop(0, 'rgba(255,120,170,0.55)');
    halo.addColorStop(1, 'rgba(255,80,140,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, e.r * 2.6, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    const r = e.r * 0.62;
    ctx.beginPath();
    ctx.moveTo(0, r * 1.5);
    ctx.bezierCurveTo(-r * 2.2, -r * 0.2, -r * 0.9, -r * 1.9, 0, -r * 0.55);
    ctx.bezierCurveTo(r * 0.9, -r * 1.9, r * 2.2, -r * 0.2, 0, r * 1.5);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -r * 2, 0, r * 1.5);
    g.addColorStop(0, '#ffd0e2');
    g.addColorStop(1, '#ff4f86');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();
  }

  drawWisp(ctx, e, t) {
    const w = Math.sin(t * 6 + e.phase);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, e.r * 2.6);
    g.addColorStop(0, 'rgba(255,190,120,0.85)');
    g.addColorStop(0.45, 'rgba(255,110,60,0.35)');
    g.addColorStop(1, 'rgba(255,60,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, e.r * 2.6, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Tattered shade body
    ctx.fillStyle = '#170a1f';
    ctx.beginPath();
    ctx.moveTo(0, -e.r);
    ctx.quadraticCurveTo(e.r, -e.r * 0.4, e.r * 0.82, e.r * 0.5);
    ctx.quadraticCurveTo(e.r * 0.4, e.r * (0.8 + w * 0.25), 0, e.r * 0.55);
    ctx.quadraticCurveTo(-e.r * 0.4, e.r * (0.9 - w * 0.25), -e.r * 0.82, e.r * 0.5);
    ctx.quadraticCurveTo(-e.r, -e.r * 0.4, 0, -e.r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffce6a';
    ctx.beginPath(); ctx.ellipse(-e.r * 0.3, -e.r * 0.15, 2.6, 3.4, -0.2, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.ellipse(e.r * 0.3, -e.r * 0.15, 2.6, 3.4, 0.2, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  drawSpike(ctx, e, pal) {
    const [ax, ay, bx, by, cx, cy] = spikeTri(e, 0);
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy);
    ctx.closePath();
    const g = ctx.createLinearGradient(ax, ay, cx, cy);
    g.addColorStop(0, pal.rock0);
    g.addColorStop(1, mix(pal.rock1, '#000000', 0.25));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = withAlpha(pal.edgeHex, 0.5);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax + (bx - ax) * 0.28, ay);
    ctx.lineTo(cx, cy);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  drawCrystal(ctx, e, pal, t) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    const hw = w / 2;
    const tipIn = e.dir < 0 ? y : y + h;      // pointed end faces the tunnel
    const flat = e.dir < 0 ? y + h : y;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cy = (tipIn + flat) / 2, cr = Math.max(hw * 2.1, h * 0.62);
    const halo = ctx.createRadialGradient(x, cy, 1, x, cy, cr);
    halo.addColorStop(0, withAlpha(pal.edgeHex, 0.38 + (e.hp === 1 ? 0.16 : 0)));
    halo.addColorStop(1, withAlpha(pal.edgeHex, 0));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(x, cy, cr, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();
    ctx.moveTo(x - hw, flat);
    ctx.lineTo(x - hw * 0.7, (flat * 2 + tipIn) / 3);
    ctx.lineTo(x, tipIn);
    ctx.lineTo(x + hw * 0.7, (flat * 2 + tipIn) / 3);
    ctx.lineTo(x + hw, flat);
    ctx.closePath();
    const g = ctx.createLinearGradient(x - hw, flat, x + hw, tipIn);
    g.addColorStop(0, mix(pal.edgeHex, '#ffffff', 0.35));
    g.addColorStop(0.55, pal.edge);
    g.addColorStop(1, mix(pal.edgeHex, '#000000', 0.45));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, tipIn); ctx.lineTo(x - hw * 0.45, flat);
    ctx.moveTo(x, tipIn); ctx.lineTo(x + hw * 0.45, flat);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (e.hp === 1) { // cracked
      ctx.strokeStyle = 'rgba(20,0,30,0.6)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - hw * 0.6, flat + (tipIn - flat) * 0.2);
      ctx.lineTo(x + hw * 0.1, flat + (tipIn - flat) * 0.5);
      ctx.lineTo(x - hw * 0.3, flat + (tipIn - flat) * 0.8);
      ctx.stroke();
    }
    if (e.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${e.flash * 0.7})`;
      ctx.fill();
    }
    ctx.restore();
  }

  drawGate(ctx, e, pal, t) {
    if (e.open > 0) return;
    const armW = 30, hw = armW / 2;
    ctx.save();
    for (const [y0, y1] of [[e.c, e.y - e.r], [e.y + e.r, e.f]]) {
      const g = ctx.createLinearGradient(e.x - hw, 0, e.x + hw, 0);
      g.addColorStop(0, mix(pal.rock1, '#000000', 0.2));
      g.addColorStop(0.4, pal.rock0);
      g.addColorStop(1, mix(pal.rock1, '#000000', 0.35));
      ctx.fillStyle = g;
      ctx.fillRect(e.x - hw, y0, armW, y1 - y0);
      ctx.strokeStyle = withAlpha(pal.edgeHex, 0.55);
      ctx.lineWidth = 1.6;
      ctx.strokeRect(e.x - hw, y0, armW, y1 - y0);
      // rune bands
      ctx.strokeStyle = withAlpha(pal.edgeHex, 0.35 + Math.sin(t * 3) * 0.12);
      ctx.lineWidth = 2.2;
      for (let y = y0 + 22; y < y1 - 10; y += 34) {
        ctx.beginPath();
        ctx.moveTo(e.x - hw + 4, y);
        ctx.lineTo(e.x + hw - 4, y);
        ctx.stroke();
      }
    }

    const pulse = 0.75 + Math.sin(t * 4) * 0.25;
    ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createRadialGradient(e.x, e.y, 2, e.x, e.y, e.r * 2.6);
    rg.addColorStop(0, withAlpha(pal.edgeHex, 0.9 * pulse));
    rg.addColorStop(0.4, withAlpha(pal.edgeHex, 0.35 * pulse));
    rg.addColorStop(1, withAlpha(pal.edgeHex, 0));
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 2.6, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.translate(e.x, e.y);
    ctx.rotate(t * 0.7);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 6.2832;
      ctx.moveTo(Math.cos(a) * e.r * 0.75, Math.sin(a) * e.r * 0.75);
      ctx.lineTo(Math.cos(a + 2.094) * e.r * 0.75, Math.sin(a + 2.094) * e.r * 0.75);
    }
    ctx.stroke();
    ctx.rotate(-t * 1.4);
    ctx.fillStyle = e.hp <= 1 ? '#fff0b0' : '#ffffff';
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.3 * pulse, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  drawFire(ctx, game) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of game.fires) {
      const k = 1 - b.age / b.life;
      const r = b.r * (0.55 + k * 0.75) * b.jitter;
      const wob = Math.sin(game.time * 26 + b.seed) * r * 0.28;
      const g = ctx.createRadialGradient(b.x, b.y + wob, 1, b.x, b.y + wob, r * 2.2);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * k})`);
      g.addColorStop(0.3, withAlpha(C.DRAGON.flame, 0.75 * k));
      g.addColorStop(1, withAlpha(C.DRAGON.flame, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y + wob, r * 2.2, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  drawParticles(ctx, game) {
    const l = game.particles.list;
    ctx.save();
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      const k = 1 - p.age / p.life;
      const add = p.kind === 'flame' || p.kind === 'spark' || p.kind === 'ring';
      ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
      if (p.kind === 'ring') {
        ctx.strokeStyle = withAlpha('#ffffff', k * 0.8);
        ctx.lineWidth = 3 * k + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.4 - k), 0, 6.2832);
        ctx.stroke();
        continue;
      }
      ctx.globalAlpha = p.kind === 'dust' ? k * 0.5 : k;
      ctx.fillStyle = p.color;
      if (p.kind === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const s = p.size * (0.5 + k * 0.6);
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.lineTo(s * 0.6, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.6, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.35 + k * 0.75), 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  // --- the dragon -------------------------------------------------------
  // Drawn back-to-front in local space with the snout at +x. Everything is
  // vector art so it stays sharp at any device pixel ratio.
  drawDragon(ctx, game, pal) {
    const d = game.dragon;
    const D = C.DRAGON;
    const flap = Math.sin(d.flapPhase);
    const wag = Math.sin(d.tailPhase);
    const blink = d.invuln > 0 && Math.floor(d.invuln * 12) % 2 === 0;

    ctx.save();
    ctx.translate(d.x, d.y + flap * 3.5 * d.flapPower);
    ctx.rotate(d.tilt);

    if (d.raging) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 6, 0, 0, 86);
      g.addColorStop(0, withAlpha(D.flame, 0.5));
      g.addColorStop(0.45, withAlpha(D.flame, 0.2));
      g.addColorStop(1, withAlpha(D.flame, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 86, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
    if (blink) ctx.globalAlpha = 0.4;

    const hurt = d.hurtFlash > 0 ? Math.min(0.85, d.hurtFlash * 2.2) : 0;
    const skin = {
      light: hurt ? mix(D.bodyLight, '#ffffff', hurt) : D.bodyLight,
      mid: hurt ? mix(D.body, '#ffffff', hurt) : D.body,
      dark: hurt ? mix(D.bodyDark, '#ffffff', hurt * 0.7) : D.bodyDark,
      line: hurt ? '#ffffff' : '#38115f',
    };

    this.dragonWing(ctx, flap, true, D, skin);
    this.dragonTail(ctx, wag, skin, D);
    this.dragonRidge(ctx, wag, D);
    this.dragonBody(ctx, flap, skin, D);
    this.dragonNeck(ctx, skin);
    this.dragonHead(ctx, d, skin, D);
    this.dragonWing(ctx, flap, false, D, skin);

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  dragonTail(ctx, wag, skin, D) {
    const tipX = -64, tipY = -2 + wag * 17;
    const midY = 3 + wag * 8;
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.quadraticCurveTo(-34, midY - 4, tipX, tipY - 2);
    ctx.quadraticCurveTo(-34, midY + 5, -8, 9);
    ctx.closePath();
    ctx.fillStyle = skin.dark;
    ctx.fill();
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Spade fin, aligned with the direction the tail is actually pointing.
    const ang = Math.atan2(tipY - midY, tipX + 36);
    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.quadraticCurveTo(-5, -11, -19, -9);
    ctx.quadraticCurveTo(-9, 0, -19, 9);
    ctx.quadraticCurveTo(-5, 11, 4, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(-19, 0, 4, 0);
    g.addColorStop(0, D.membraneLight);
    g.addColorStop(1, D.membrane);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  /** Crest running from the shoulders down the spine. */
  dragonRidge(ctx, wag, D) {
    ctx.fillStyle = D.crest;
    ctx.strokeStyle = '#5a1f96';
    ctx.lineWidth = 1.1;
    const spine = [[13, -11, 10], [5, -14.5, 12], [-3, -14.5, 11], [-11, -12.5, 9.5],
                   [-19, -9, 8], [-27, -4.5, 6.5], [-35, 0.5, 5]];
    for (let i = 0; i < spine.length; i++) {
      const t = i / (spine.length - 1);
      const x = spine[i][0];
      const y = spine[i][1] + (t > 0.4 ? wag * (t - 0.4) * 16 : 0);
      const h = spine[i][2];
      ctx.beginPath();
      ctx.moveTo(x + 4.6, y + 3);
      ctx.lineTo(x - 0.8, y - h);
      ctx.lineTo(x - 5.4, y + 3.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  dragonBody(ctx, flap, skin, D) {
    // hind leg tucked under the body
    ctx.fillStyle = skin.dark;
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-6, 4);
    ctx.quadraticCurveTo(-13, 15, -4, 18);
    ctx.quadraticCurveTo(6, 19, 7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = D.horn;
    for (const dx of [-5, -1.5, 2]) {
      ctx.beginPath();
      ctx.moveTo(dx - 1.6, 15.5); ctx.lineTo(dx - 3.4, 19.5); ctx.lineTo(dx + 1.4, 18);
      ctx.closePath(); ctx.fill();
    }

    ctx.beginPath();
    ctx.ellipse(2, 0, 23, 14, -0.06, 0, 6.2832);
    const g = ctx.createLinearGradient(0, -15, 4, 15);
    g.addColorStop(0, skin.light);
    g.addColorStop(0.42, skin.mid);
    g.addColorStop(1, skin.dark);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Belly scutes: a narrow band along the underside, not a full oval.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(2, 0, 23, 14, -0.06, 0, 6.2832);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(-16, 6);
    ctx.quadraticCurveTo(4, 16, 22, 3);
    ctx.lineTo(22, 17);
    ctx.lineTo(-16, 17);
    ctx.closePath();
    ctx.fillStyle = D.belly;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(110,55,165,0.4)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 5; i++) {
      const x = -12 + i * 8;
      ctx.beginPath();
      ctx.moveTo(x, 7 + Math.abs(i - 2) * 0.8);
      ctx.lineTo(x + 1.5, 16);
      ctx.stroke();
    }
    ctx.restore();

    // foreleg
    ctx.fillStyle = skin.mid;
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(13, 2);
    ctx.quadraticCurveTo(19, 11, 13, 14);
    ctx.quadraticCurveTo(7, 14, 8, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = D.horn;
    for (const dx of [0, 3]) {
      ctx.beginPath();
      ctx.moveTo(13 + dx, 12); ctx.lineTo(16.5 + dx, 15.5); ctx.lineTo(11.5 + dx, 14.8);
      ctx.closePath(); ctx.fill();
    }
  }

  dragonNeck(ctx, skin) {
    ctx.beginPath();
    ctx.moveTo(10, -12);
    ctx.quadraticCurveTo(21, -18, 30, -16);
    ctx.lineTo(31, -3);
    ctx.quadraticCurveTo(22, -3, 15, 6);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -18, 0, 6);
    g.addColorStop(0, skin.light);
    g.addColorStop(1, skin.mid);
    ctx.fillStyle = g;
    ctx.fill();
    // Outline only the exposed upper and lower edges - no seam across the body.
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(10, -12);
    ctx.quadraticCurveTo(21, -18, 30, -16);
    ctx.moveTo(31, -3);
    ctx.quadraticCurveTo(22, -3, 15, 6);
    ctx.stroke();
  }

  dragonHead(ctx, d, skin, D) {
    ctx.save();
    ctx.translate(29, -12);

    // horns first so they sit behind the skull
    ctx.fillStyle = D.horn;
    ctx.strokeStyle = 'rgba(120,80,20,0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-4, -6);
    ctx.quadraticCurveTo(-14, -14, -24, -15);
    ctx.quadraticCurveTo(-14, -9, -7, -2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, -2);
    ctx.quadraticCurveTo(-16, -5, -23, -3);
    ctx.quadraticCurveTo(-14, 1, -8, 3);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // skull + snout
    ctx.beginPath();
    ctx.moveTo(-9, -5);
    ctx.quadraticCurveTo(-2, -11, 7, -8);
    ctx.lineTo(19, -5);
    ctx.quadraticCurveTo(21, -1, 17, 0);
    ctx.lineTo(8, 1);
    ctx.quadraticCurveTo(2, 6, -7, 5);
    ctx.quadraticCurveTo(-13, 1, -9, -5);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -11, 0, 6);
    g.addColorStop(0, skin.light);
    g.addColorStop(1, skin.mid);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // jaw + a single visible fang
    ctx.strokeStyle = 'rgba(45,12,80,0.55)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(18, -0.6);
    ctx.quadraticCurveTo(8, 2.4, -4, 2.2);
    ctx.stroke();
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.moveTo(15.5, 0.4); ctx.lineTo(14, 4); ctx.lineTo(12.6, 0.2);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = 'rgba(35,5,60,0.55)';
    ctx.beginPath(); ctx.ellipse(16.5, -3.2, 1.5, 1.1, 0.3, 0, 6.2832); ctx.fill();

    // eye
    ctx.fillStyle = '#1a0630';
    ctx.beginPath(); ctx.ellipse(1, -3.4, 5.4, 4.6, -0.12, 0, 6.2832); ctx.fill();
    ctx.fillStyle = d.raging ? '#ff9d5c' : D.eye;
    ctx.beginPath(); ctx.ellipse(1.4, -3.4, 4.1, 3.4, -0.12, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#20062e';
    ctx.beginPath(); ctx.ellipse(2.4, -3.4, 1.2, 3.0, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(0.2, -4.8, 1.15, 0, 6.2832); ctx.fill();

    // little brow horn
    ctx.fillStyle = D.horn;
    ctx.beginPath();
    ctx.moveTo(8, -8); ctx.lineTo(11, -13); ctx.lineTo(12, -7);
    ctx.closePath(); ctx.fill();

    // heat gathering in the throat
    const heat = clamp((d.ember - 55) / 45, 0, 1) * (d.raging ? 0.8 : 0.42);
    if (heat > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      const eg = ctx.createRadialGradient(20, -2, 0, 20, -2, 9);
      eg.addColorStop(0, withAlpha(D.flameHot, 0.5 * heat));
      eg.addColorStop(1, withAlpha(D.flame, 0));
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.arc(20, -2, 9, 0, 6.2832); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  dragonWing(ctx, flap, far, D, skin) {
    // The far wing runs a little behind the near one so both read in silhouette.
    const f = far ? Math.sin(Math.asin(clamp(flap, -1, 1)) - 0.55) : flap;
    const ang = (far ? -0.30 : -0.34) + f * (far ? 0.95 : 1.2);
    ctx.save();
    ctx.translate(far ? -7 : 1, far ? -5 : -10);
    ctx.rotate(ang);
    if (far) ctx.scale(0.8, 0.8);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-20, -30, -8, -60);   // leading edge to the tip
    ctx.quadraticCurveTo(2, -44, 12, -37);     // scallop 1
    ctx.quadraticCurveTo(6, -30, 20, -20);     // scallop 2
    ctx.quadraticCurveTo(12, -14, 19, -1);     // scallop 3
    ctx.quadraticCurveTo(8, -3, 0, 0);
    ctx.closePath();

    const g = ctx.createLinearGradient(-10, -58, 16, 0);
    g.addColorStop(0, far ? '#4a1a80' : D.membraneLight);
    g.addColorStop(1, far ? '#2c0f52' : D.membrane);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = far ? '#26094a' : skin.line;
    ctx.lineWidth = far ? 1.4 : 1.6;
    ctx.stroke();

    ctx.strokeStyle = far ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const [x, y] of [[12, -37], [20, -20], [19, -1]]) { ctx.moveTo(0, 0); ctx.lineTo(x, y); }
    ctx.stroke();

    ctx.fillStyle = far ? '#8a6a3a' : D.horn;
    ctx.beginPath();
    ctx.moveTo(-8, -60); ctx.lineTo(-15, -67); ctx.lineTo(-4, -62);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // --- lighting / post --------------------------------------------------
  drawLighting(ctx, game, pal) {
    if (pal.dark < 0.03) return;
    const l = this.lctx;
    const W = this.light.width, H = this.light.height;
    const sx = W / C.VIEW_W;
    const sy = H / this.viewH;

    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'copy'; // replace last frame instead of stacking on it
    l.fillStyle = `rgba(2,0,8,${pal.dark})`;
    l.fillRect(0, 0, W, H);
    l.globalCompositeOperation = 'destination-out';

    // One cached falloff sprite, blitted per light: far cheaper than building a
    // gradient object for every lamp on every frame.
    const sprite = this.lightSprite;
    const hole = (wx, wy, r, strength) => {
      const x = (wx - game.camX) * sx, y = wy * sy;
      const rr = r * sx;
      if (x < -rr || x > W + rr) return;
      l.globalAlpha = strength;
      l.drawImage(sprite, x - rr, y - rr, rr * 2, rr * 2);
    };

    const d = game.dragon;
    hole(d.x + 20, d.y - 8, d.raging ? 260 : 150, 1);
    for (const b of game.fires) hole(b.x, b.y, 90 * (1 - b.age / b.life) + 40, 0.95);
    for (const e of game.world.ents) {
      if (e.dead) continue;
      if (e.kind === 'gem') hole(e.x, e.y, 60, 0.7);
      else if (e.kind === 'gate' && e.open === 0) hole(e.x, e.y, 110, 0.85);
      else if (e.kind === 'wisp') hole(e.x, e.y, 70, 0.75);
      else if (e.kind === 'heart') hole(e.x, e.y, 70, 0.8);
    }
    l.globalAlpha = 1;
    l.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.light, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    if (pal.dark > 0.2) this.drawTerrainVeins(ctx, game, pal);
  }

  drawVignette(ctx, game, pal) {
    const W = this.cssW, H = this.cssH;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const d = game.dragon;
    if (game.state === 'playing' && d.hearts === 1) {
      const p = 0.18 + Math.sin(game.time * 5) * 0.08;
      const r = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      r.addColorStop(0, 'rgba(255,0,60,0)');
      r.addColorStop(1, `rgba(255,0,60,${p})`);
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // --- HUD --------------------------------------------------------------
  drawHud(ctx, game, pal) {
    const d = game.dragon;
    const W = this.cssW;
    const pad = 14;
    const top = this.safe.top + pad;
    const left = this.safe.left + pad;
    const right = W - this.safe.right - pad;

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.font = '700 13px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';

    // hearts
    for (let i = 0; i < C.HEARTS_MAX; i++) {
      const filled = i < d.hearts;
      if (i >= C.HEARTS_START && !filled) continue;
      const x = left + i * 22, y = top + 2;
      ctx.save();
      ctx.translate(x + 7, y + 8);
      const s = filled ? 1 + (d.hurtFlash > 0 ? d.hurtFlash * 0.5 : 0) : 0.82;
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.bezierCurveTo(-9, -1, -4, -8, 0, -2.5);
      ctx.bezierCurveTo(4, -8, 9, -1, 0, 6);
      ctx.closePath();
      ctx.fillStyle = filled ? '#ff4f86' : 'rgba(255,255,255,0.16)';
      ctx.fill();
      if (filled) { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.restore();
    }

    // ember + rage bars
    const barW = 108, barH = 7, bx = left, by = top + 24;
    const bar = (y, frac, from, to, label) => {
      roundRect(ctx, bx, y, barW, barH, barH / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      const g = ctx.createLinearGradient(bx, 0, bx + barW, 0);
      g.addColorStop(0, from); g.addColorStop(1, to);
      if (frac > 0.001) {
        ctx.save();
        roundRect(ctx, bx, y, barW, barH, barH / 2);
        ctx.clip();
        ctx.fillStyle = g;
        ctx.fillRect(bx, y, barW * frac, barH);
        ctx.restore();
      }
      ctx.font = '700 9px ui-rounded, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(label, bx + barW + 7, y - 1);
    };
    bar(by, d.ember / C.EMBER_MAX, '#7a3ad6', '#e0a6ff', 'EMBER');
    const rageFrac = d.raging ? d.rageTime / C.RAGE_DURATION : d.rage / C.RAGE_MAX;
    const ready = d.rage >= C.RAGE_MAX || d.raging;
    bar(by + 13, rageFrac,
      ready ? '#ff7a3c' : '#8a2f5f',
      ready ? '#fff0a8' : '#ff6ba8',
      d.raging ? 'RAGE!' : 'RAGE');
    if (ready && !d.raging) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(game.time * 8) * 0.3;
      roundRect(ctx, bx - 2, by + 11, barW + 4, barH + 4, (barH + 4) / 2);
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }

    // score + multiplier
    ctx.textAlign = 'right';
    ctx.font = '800 30px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(Math.floor(game.score)), right, top);
    ctx.font = '700 12px ui-rounded, system-ui, sans-serif';
    const mult = game.multiplier;
    ctx.fillStyle = mult > 1 ? '#ffd66b' : 'rgba(255,255,255,0.45)';
    ctx.fillText(mult > 1 ? `x${mult}  ·  ${game.combo} combo` : `${Math.floor(game.distance / 10)} m`, right, top + 34);
    if (mult > 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(`${Math.floor(game.distance / 10)} m`, right, top + 50);
    }

    // banner
    if (game.banner) {
      const b = game.banner;
      const a = Math.min(1, b.life * 1.6) * Math.min(1, (2.4 - b.life) * 4);
      ctx.textAlign = 'center';
      ctx.font = '800 19px ui-rounded, system-ui, sans-serif';
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillText(b.text.toUpperCase(), W / 2, this.cssH * 0.22);
      ctx.font = '700 10px ui-rounded, system-ui, sans-serif';
      ctx.fillStyle = withAlpha(pal.edgeHex, a * 0.85);
      ctx.fillText('· · ·', W / 2, this.cssH * 0.22 + 24);
    }

    // first-run hint
    if (game.hint > 0) {
      const a = Math.min(1, game.hint);
      ctx.textAlign = 'center';
      ctx.font = '700 13px ui-rounded, system-ui, sans-serif';
      ctx.fillStyle = `rgba(255,255,255,${a * 0.85})`;
      ctx.fillText(this.hintText, W / 2, this.cssH * 0.62);
    }
    ctx.restore();
  }
}
