import test from 'node:test';
import assert from 'node:assert/strict';
import { Dragon, Particles, circleRect, circleCircle, circleTri, spikeTri } from '../src/entities.js';
import { GRAVITY, VY_MAX_DOWN, VY_MAX_UP, EMBER_MAX } from '../src/config.js';

test('circle/rect collisions cover edges and corners', () => {
  assert.ok(circleRect(10, 10, 5, 12, 8, 20, 20), 'overlapping');
  assert.ok(circleRect(11, 20, 2, 12, 8, 20, 20), 'touching left edge');
  assert.ok(!circleRect(5, 20, 2, 12, 8, 20, 20), 'clear of left edge');
  assert.ok(circleRect(9, 5, 5, 12, 8, 20, 20), 'near corner');
  assert.ok(!circleRect(7, 3, 5, 12, 8, 20, 20), 'past corner');
});

test('circle/triangle handles inside, edge and outside', () => {
  const spike = { x: 100, y: 200, w: 40, h: 60, dir: -1 };
  const tri = spikeTri(spike, 0);
  assert.deepEqual(tri, [80, 200, 120, 200, 100, 140]);
  assert.ok(circleTri(100, 170, 4, ...tri), 'inside the spike');
  assert.ok(circleTri(84, 196, 6, ...tri), 'grazing an edge');
  assert.ok(!circleTri(100, 120, 5, ...tri), 'above the apex');
  assert.ok(!circleTri(40, 200, 5, ...tri), 'well to the side');
});

test('spikeTri respects growth direction', () => {
  const fromCeiling = spikeTri({ x: 0, y: 100, w: 20, h: 50, dir: 1 }, 0);
  assert.equal(fromCeiling[5], 150, 'ceiling spike points down');
  const fromFloor = spikeTri({ x: 0, y: 100, w: 20, h: 50, dir: -1 }, 0);
  assert.equal(fromFloor[5], 50, 'floor spike points up');
});

test('circleCircle is symmetric and radius-aware', () => {
  assert.ok(circleCircle(0, 0, 5, 8, 0, 4));
  assert.ok(!circleCircle(0, 0, 5, 10, 0, 4));
  assert.equal(circleCircle(0, 0, 5, 9, 0, 4), circleCircle(9, 0, 4, 0, 0, 5));
});

test('dragon obeys its speed limits in both directions', () => {
  const d = new Dragon();
  d.reset(0, 0);
  for (let i = 0; i < 300; i++) d.update(1 / 60, false, 0);
  assert.equal(Math.round(d.vy), VY_MAX_DOWN);
  for (let i = 0; i < 300; i++) d.update(1 / 60, true, 0);
  assert.equal(Math.round(d.vy), -VY_MAX_UP);
});

test('chill biomes lighten gravity without inverting it', () => {
  const plain = new Dragon(); plain.reset(0, 0);
  const chilled = new Dragon(); chilled.reset(0, 0);
  for (let i = 0; i < 20; i++) {
    plain.update(1 / 60, false, 0);
    chilled.update(1 / 60, false, 0.16);
  }
  assert.ok(chilled.vy > 0 && chilled.vy < plain.vy, 'falls slower but still falls');
});

test('muzzle tracks head rotation', () => {
  const d = new Dragon();
  d.reset(100, 100);
  const level = d.muzzle();
  assert.ok(level.x > 140 && level.y < 100, 'snout leads and sits above centre');
  d.tilt = Math.PI / 2;
  const down = d.muzzle();
  assert.ok(down.y > 140, 'nose-down puts the muzzle below the body');
});

test('dragon starts with a full ember reserve', () => {
  const d = new Dragon();
  d.reset(0, 0);
  assert.equal(d.ember, EMBER_MAX);
  assert.ok(GRAVITY > 0);
});

test('particle pool never exceeds its cap', () => {
  const p = new Particles(40);
  p.burst(0, 0, 300, {});
  assert.equal(p.list.length, 40);
  p.update(1 / 60, 0);
  assert.ok(p.list.length <= 40);
  p.clear();
  assert.equal(p.list.length, 0);
});

test('particles expire and are culled behind the camera', () => {
  const p = new Particles();
  p.burst(0, 0, 10, { life: 0.1, speed: 0 });
  for (let i = 0; i < 20; i++) p.update(1 / 60, -1000);
  assert.equal(p.list.length, 0);
});
