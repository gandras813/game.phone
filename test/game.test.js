import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import * as C from '../src/config.js';

const fresh = () => {
  const g = new Game();
  g.resize(C.VIEW_W, 1000);
  g.start(1234);
  return g;
};

test('a run starts fully stocked and in the tunnel', () => {
  const g = fresh();
  assert.equal(g.state, 'playing');
  assert.equal(g.dragon.hearts, C.HEARTS_START);
  assert.equal(g.dragon.ember, C.EMBER_MAX);
  assert.equal(g.score, 0);
  const h = g.world.heightsAt(g.dragon.x);
  assert.ok(g.dragon.y > h.c && g.dragon.y < h.f, 'dragon starts inside the tunnel');
});

test('difficulty and speed ramp with distance and then plateau', () => {
  const g = fresh();
  assert.equal(g.difficulty, 0);
  g.distance = C.RAMP_DISTANCE / 2;
  assert.ok(Math.abs(g.difficulty - 0.5) < 1e-9);
  g.distance = C.RAMP_DISTANCE * 3;
  assert.equal(g.difficulty, 1, 'difficulty is clamped');
  g.update(1 / 60, false);
  assert.ok(Math.abs(g.speed - C.SPEED_MAX) < 1, 'speed tops out at SPEED_MAX');
});

test('firing spends ember, respects cooldown, and fizzles when dry', () => {
  const g = fresh();
  g.fire();
  assert.equal(g.fires.length, 1);
  assert.equal(g.dragon.ember, C.EMBER_MAX - C.EMBER_COST);
  g.fire(); // still on cooldown
  assert.equal(g.fires.length, 1);

  g.dragon.fireCd = 0;
  g.dragon.ember = 1;
  g.fire();
  assert.equal(g.fires.length, 1, 'no shot without ember');
  assert.ok(g.dragon.fireCd > 0, 'a dry press still costs a beat');
});

test('rage is gated on a full meter and makes the dragon untouchable', () => {
  const g = fresh();
  g.dragon.rage = C.RAGE_MAX - 1;
  g.useRage();
  assert.equal(g.dragon.raging, false);

  g.dragon.rage = C.RAGE_MAX;
  g.useRage();
  assert.equal(g.dragon.raging, true);
  assert.equal(g.dragon.rage, 0);

  const hearts = g.dragon.hearts;
  g.hurt('spike');
  assert.equal(g.dragon.hearts, hearts, 'rage absorbs the hit');
});

test('combo multiplier climbs, caps, and resets on damage', () => {
  const g = fresh();
  assert.equal(g.multiplier, 1);
  for (let i = 0; i < C.COMBO_STEP; i++) g.addCombo();
  assert.equal(g.multiplier, 2);
  for (let i = 0; i < C.COMBO_STEP * 20; i++) g.addCombo();
  assert.equal(g.multiplier, C.COMBO_MAX_MULT, 'multiplier is capped');
  assert.ok(g.bestCombo >= g.combo);

  g.hurt('rock');
  assert.equal(g.combo, 0);
  assert.equal(g.multiplier, 1);
  assert.ok(g.bestCombo > 0, 'best combo is remembered');
});

test('score awards scale with the multiplier', () => {
  const g = fresh();
  g.addScore(100);
  assert.equal(g.score, 100);
  for (let i = 0; i < C.COMBO_STEP; i++) g.addCombo();
  g.addScore(100);
  assert.equal(g.score, 300, 'second award doubled');
});

test('invulnerability window blocks repeat damage', () => {
  const g = fresh();
  g.hurt('spike');
  assert.equal(g.dragon.hearts, C.HEARTS_START - 1);
  g.hurt('spike');
  assert.equal(g.dragon.hearts, C.HEARTS_START - 1, 'second hit ignored while invulnerable');
  assert.ok(g.dragon.invuln > 0);
});

test('losing every heart ends the run and records the result', () => {
  const g = fresh();
  g.gems = 9;
  g.kills = 4;
  g.distance = 2500;
  for (let i = 0; i < C.HEARTS_START; i++) {
    g.dragon.invuln = 0;
    g.hurt('spike');
  }
  assert.equal(g.state, 'dying');
  for (let i = 0; i < 200; i++) g.update(1 / 60, false);
  assert.equal(g.state, 'gameover');
  assert.equal(g.result.gems, 9);
  assert.equal(g.result.kills, 4);
  assert.equal(g.result.distance, 250);
  assert.equal(g.result.cause, 'spike');
  assert.equal(g.result.score, Math.floor(g.score));
});

test('the dragon cannot be pushed out of the tunnel', () => {
  const g = fresh();
  for (let i = 0; i < 600; i++) g.update(1 / 60, i % 40 < 12);
  if (g.state === 'playing') {
    const h = g.world.heightsAt(g.dragon.x);
    assert.ok(g.dragon.y >= h.c - 1 && g.dragon.y <= h.f + 1, 'stayed between the walls');
  }
});

test('a full run simulates without throwing and keeps state finite', () => {
  const g = fresh();
  for (let i = 0; i < 4000; i++) {
    g.update(1 / 60, Math.sin(i / 17) > 0);
    if (i % 9 === 0) g.fire();
    if (g.dragon.rage >= C.RAGE_MAX) g.useRage();
    assert.ok(Number.isFinite(g.dragon.y), 'dragon position stayed finite');
    assert.ok(Number.isFinite(g.score), 'score stayed finite');
    if (g.state === 'gameover') g.start(i);
  }
  assert.ok(g.particles.list.length <= g.particles.max);
});

test('menu idle flight keeps the dragon centred without scoring', () => {
  const g = new Game();
  g.resize(C.VIEW_W, 1000);
  g.state = 'menu';
  g.world.reset(1000, 3);
  for (let i = 0; i < 400; i++) g.update(1 / 60, false);
  assert.equal(g.score, 0);
  assert.equal(g.dragon.hearts, C.HEARTS_START);
  const h = g.world.heightsAt(g.dragon.x);
  assert.ok(g.dragon.y > h.c && g.dragon.y < h.f);
});
