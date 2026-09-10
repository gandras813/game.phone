import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, clamp, lerp, rand, randInt, pick, smoothstep, hashNoise } from '../src/rng.js';

test('seeded rng is deterministic and well distributed', () => {
  const a = makeRng(42), b = makeRng(42);
  const xs = [];
  for (let i = 0; i < 2000; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
    xs.push(v);
  }
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.04, `mean drifted to ${mean}`);
  assert.notEqual(makeRng(42)(), makeRng(43)());
});

test('numeric helpers behave at their boundaries', () => {
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
  assert.equal(lerp(10, 20, 0.5), 15);
  assert.equal(smoothstep(-1), 0);
  assert.equal(smoothstep(2), 1);
  assert.equal(smoothstep(0.5), 0.5);
});

test('rand/randInt/pick stay inside their ranges', () => {
  const r = makeRng(7);
  for (let i = 0; i < 500; i++) {
    const v = rand(r, -3, 8);
    assert.ok(v >= -3 && v <= 8);
    const n = randInt(r, 2, 5);
    assert.ok(Number.isInteger(n) && n >= 2 && n <= 5);
    assert.ok(['a', 'b', 'c'].includes(pick(r, ['a', 'b', 'c'])));
  }
});

test('hash noise is stable and bounded', () => {
  assert.equal(hashNoise(12.5, 1), hashNoise(12.5, 1));
  assert.notEqual(hashNoise(12.5, 1), hashNoise(12.5, 2));
  for (let x = 0; x < 200; x += 0.7) {
    const n = hashNoise(x, 0);
    assert.ok(n >= 0 && n < 1);
  }
});
