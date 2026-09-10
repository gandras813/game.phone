#!/usr/bin/env node
/**
 * Headless balance harness.
 *
 * Runs the real Game loop with a scripted pilot so pacing changes can be
 * measured instead of guessed at. Usage:
 *   node tools/sim.js [runs] [skill 0..1]
 */

import { Game } from '../src/game.js';
import * as C from '../src/config.js';

const RUNS = Number(process.argv[2] || 24);
const SKILL = Number(process.argv[3] ?? 0.8);
const DT = 1 / 60;
const MAX_SECONDS = 240;

/** Scripted pilot: aim down the tunnel, grab gems, burn what it can. */
function pilot(game, jitter) {
  // pilot.hold persists between frames (hysteresis state)
  const d = game.dragon;
  const look = 70 + game.speed * 0.35;
  const a = game.world.heightsAt(d.x + look);
  const b = game.world.heightsAt(d.x + look * 1.8);
  let aim = ((a.c + a.f) / 2) * 0.6 + ((b.c + b.f) / 2) * 0.4;

  for (const e of game.world.ents) {
    if (e.dead || e.x < d.x - 10 || e.x > d.x + look * 2.4) continue;
    if (e.kind === 'gem' || e.kind === 'heart') aim = aim * 0.6 + e.y * 0.4;
    else if (e.kind === 'spike') {
      const clear = 46;
      aim = e.dir < 0 ? Math.min(aim, e.y - e.h - clear) : Math.max(aim, e.y + e.h + clear);
    } else if (e.kind === 'crystal') {
      // e.y is the crystal's top; dir -1 grows up from the floor, +1 down from the ceiling.
      aim = e.dir < 0 ? Math.min(aim, e.y - 40) : Math.max(aim, e.y + e.h + 40);
    }
  }
  aim = Math.max(a.c + d.r + 12, Math.min(a.f - d.r - 12, aim)) + jitter;

  // Predictive with hysteresis, so the pilot glides instead of chattering.
  // Lead time is asymmetric: stopping a dive costs more height than stopping a climb.
  const predicted = d.y + d.vy * (d.vy > 0 ? 0.26 : 0.16);
  if (predicted > aim + 10) pilot.hold = true;
  else if (predicted < aim - 10) pilot.hold = false;
  const holding = pilot.hold;

  const burn = game.world.ents.some((e) => !e.dead && e.x > d.x && e.x < d.x + 300
    && (e.kind === 'gate' || e.kind === 'wisp' || (e.kind === 'crystal' && Math.abs(e.y + e.h / 2 - d.y) < 120))
    && Math.abs(e.y - d.y) < 140);
  return { holding, burn };
}

const results = [];
for (let run = 0; run < RUNS; run++) {
  const game = new Game();
  game.resize(C.VIEW_W, 1040);
  game.start(1000 + run);
  let t = 0;
  let jitter = 0;
  const hitsAt = [];
  let hearts = game.dragon.hearts;

  while (game.state === 'playing' && t < MAX_SECONDS) {
    // Imperfect aim, refreshed a few times a second, scaled by skill.
    if (Math.random() < 0.06) jitter = (Math.random() - 0.5) * 150 * (1 - SKILL);
    const { holding, burn } = pilot(game, jitter);
    if (burn && Math.random() < 0.35 + SKILL * 0.5) game.fire();
    if (game.dragon.rage >= C.RAGE_MAX && Math.random() < 0.02) game.useRage();
    game.update(DT, holding);
    if (game.dragon.hearts < hearts) {
      hearts = game.dragon.hearts;
      hitsAt.push({ at: Math.round(game.distance), by: game.lastCause });
    }
    t += DT;
  }
  results.push({
    seconds: +t.toFixed(1),
    distance: Math.round(game.distance),
    metres: Math.round(game.distance / 10),
    score: Math.round(game.score),
    gems: game.gems,
    kills: game.kills,
    combo: game.bestCombo,
    survived: game.state === 'playing',
    emberLeft: Math.round(game.dragon.ember),
    hitsAt,
  });
}

const pick = (k) => results.map((r) => r[k]).sort((a, b) => a - b);
const med = (a) => a[Math.floor(a.length / 2)];
const avg = (a) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
const dist = pick('distance'), score = pick('score'), secs = pick('seconds');

console.log(`skill ${SKILL}  ·  ${RUNS} runs`);
console.log(`  survival   median ${med(secs)}s   min ${secs[0]}s   max ${secs[secs.length - 1]}s`);
console.log(`  distance   median ${med(dist)}u (${Math.round(med(dist) / 10)} m)   avg ${avg(dist)}u   max ${dist[dist.length - 1]}u`);
console.log(`  score      median ${med(score)}   max ${score[score.length - 1]}`);
console.log(`  gems ${avg(pick('gems'))}   kills ${avg(pick('kills'))}   best combo ${avg(pick('combo'))}`);
console.log(`  reached max difficulty: ${results.filter((r) => r.distance >= C.RAMP_DISTANCE).length}/${RUNS}`);
const allHits = results.flatMap((r) => r.hitsAt);
const byCause = {};
for (const h of allHits) byCause[h.by] = (byCause[h.by] || 0) + 1;
console.log(`  hits by cause: ${Object.entries(byCause).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('  ')}`);
console.log(`  hits inside the first 600u: ${allHits.filter((h) => h.at < 600).length}`);
console.log(`  ember empty at death: ${results.filter((r) => r.emberLeft < C.EMBER_COST).length}/${RUNS}`);
