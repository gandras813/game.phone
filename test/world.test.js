import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { STEP, WALL_MARGIN } from '../src/config.js';

const SCREENS = [560, 720, 900, 1040, 1200];

test('terrain always leaves a flyable, on-screen tunnel', () => {
  for (const viewH of SCREENS) {
    for (const seed of [1, 7, 99, 4242]) {
      const w = new World();
      w.reset(viewH, seed);
      for (let i = 0; i < 900; i++) w.step(Math.min(1, i / 700));
      for (const s of w.samples) {
        assert.ok(s.c >= WALL_MARGIN - 0.001, `ceiling above screen at seed ${seed}: ${s.c}`);
        assert.ok(s.f <= viewH - WALL_MARGIN + 0.001, `floor below screen at seed ${seed}: ${s.f}`);
        assert.ok(s.f - s.c >= 149, `tunnel too tight at seed ${seed}: ${s.f - s.c}`);
      }
    }
  }
});

test('hazards never block the tunnel completely', () => {
  const w = new World();
  w.reset(900, 11);
  for (let i = 0; i < 1500; i++) w.step(Math.min(1, i / 700));
  for (const e of w.ents) {
    const h = w.heightsAt(e.x);
    const gap = h.f - h.c;
    if (e.kind === 'spike' || e.kind === 'crystal') {
      // Something has to remain flyable beside every solid obstacle.
      assert.ok(gap - e.h > 100, `${e.kind} leaves only ${gap - e.h} of passage`);
    }
    if (e.kind === 'gem' || e.kind === 'heart' || e.kind === 'wisp') {
      assert.ok(e.y > h.c - 60 && e.y < h.f + 60, `${e.kind} spawned inside rock`);
    }
  }
});

test('every rune gate is preceded by gems, so it can always be opened', () => {
  const w = new World();
  w.reset(1000, 5);
  for (let i = 0; i < 4000; i++) w.step(Math.min(1, i / 700));
  const gates = w.ents.filter((e) => e.kind === 'gate');
  assert.ok(gates.length > 0, 'expected the generator to produce gates');
  for (const g of gates) {
    const nearby = w.ents.filter((e) => e.kind === 'gem' && e.x < g.x && e.x > g.x - 260);
    assert.ok(nearby.length >= 2, `gate at ${g.x} has only ${nearby.length} gems on approach`);
  }
});

test('generation is deterministic for a seed', () => {
  const run = () => {
    const w = new World();
    w.reset(900, 20250910);
    for (let i = 0; i < 400; i++) w.step(0.5);
    return w.samples.map((s) => `${s.c.toFixed(3)}/${s.f.toFixed(3)}`).join('|');
  };
  assert.equal(run(), run());
});

test('all section types and hazard kinds appear over a long run', () => {
  const w = new World();
  w.reset(950, 3);
  const seen = new Set();
  const orig = w.beginSection.bind(w);
  w.beginSection = (d) => { orig(d); seen.add(w.section.type); };
  for (let i = 0; i < 3000; i++) w.step(Math.min(1, i / 700));
  for (const t of ['open', 'narrow', 'pillars', 'crystals', 'swarm', 'gate', 'treasure']) {
    assert.ok(seen.has(t), `section "${t}" never generated`);
  }
  const kinds = new Set(w.ents.map((e) => e.kind));
  for (const k of ['gem', 'wisp', 'spike', 'crystal']) {
    assert.ok(kinds.has(k), `hazard "${k}" never generated`);
  }
});

test('streaming keeps memory bounded and heights interpolate', () => {
  const w = new World();
  w.reset(900, 8);
  for (let pass = 0; pass < 30; pass++) {
    w.ensure(pass * 600 + 1200, 0.5);
    w.prune(pass * 600);
  }
  assert.ok(w.samples.length < 200, `sample buffer grew to ${w.samples.length}`);

  const a = w.samples[3], b = w.samples[4];
  const mid = w.heightsAt((a.x + b.x) / 2);
  assert.ok(Math.abs(mid.c - (a.c + b.c) / 2) < 1e-6);
  assert.equal(w.heightsAt(a.x).c, a.c);
  assert.equal(Math.round(b.x - a.x), STEP);
});
