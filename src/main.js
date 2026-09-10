/**
 * Bootstrap: wires canvas, loop, UI screens and persistence together.
 */

import * as C from './config.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { AudioKit, makeFx } from './audio.js';
import { save } from './storage.js';

const $ = (id) => document.getElementById(id);

const frame = $('frame');
const canvas = $('game');
const controls = $('controls');
const btnFire = $('btn-fire');
const btnRage = $('btn-rage');
const btnPause = $('btn-pause');
const screens = {
  title: $('screen-title'),
  over: $('screen-over'),
  pause: $('screen-pause'),
};

const renderer = new Renderer(canvas);
const audio = new AudioKit(save.get('sound'));
const fx = makeFx(audio, { haptics: () => save.get('haptics') });
const game = new Game(fx);
const input = new Input(frame, { fire: btnFire, rage: btnRage });

// --- layout ------------------------------------------------------------
function safeInsets() {
  const cs = getComputedStyle($('safe-probe'));
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

function layout() {
  const r = frame.getBoundingClientRect();
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const viewH = renderer.resize(Math.max(1, r.width), Math.max(1, r.height), dpr, safeInsets());
  game.resize(C.VIEW_W, viewH);
}

addEventListener('resize', layout);
addEventListener('orientationchange', () => setTimeout(layout, 120));
window.visualViewport?.addEventListener('resize', layout);
layout();

// --- screens -----------------------------------------------------------
let screen = 'title';

function show(name) {
  screen = name;
  for (const [key, el] of Object.entries(screens)) el.classList.toggle('hidden', key !== name);
  controls.classList.toggle('hidden', name !== null);
}

const EPITAPH = {
  ceiling: 'Clipped the roof of the world',
  floor: 'Met the cavern floor',
  spike: 'Impaled on cold stone',
  crystal: 'Shattered against a crystal',
  gate: 'The rune gate held',
  wisp: 'Taken by the wisps',
  rock: 'The ember dims',
};

function showTitle() {
  const s = save.all();
  $('title-stats').innerHTML = statBlock([
    ['Best', s.best || 0],
    ['Deepest', `${s.bestDistance || 0} m`],
    ['Gems', s.totalGems || 0],
    ['Runs', s.runs || 0],
  ]);
  show('title');
}

function statBlock(rows) {
  return rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function showGameOver() {
  const r = game.result;
  $('over-title').textContent = r.newBest
    ? 'A new depth record'
    : (EPITAPH[r.cause] || EPITAPH.rock);
  $('over-score').textContent = r.score;
  const best = $('over-best');
  best.textContent = r.newBest ? '★ NEW BEST' : `BEST ${r.best}`;
  best.classList.toggle('new', r.newBest);
  $('over-stats').innerHTML = statBlock([
    ['Distance', `${r.distance} m`],
    ['Gems', r.gems],
    ['Wisps burned', r.kills],
    ['Best combo', r.combo],
  ]);
  show('over');
}

// --- flow --------------------------------------------------------------
function startRun() {
  audio.unlock();
  audio.setBiome(0);
  if (save.get('sound')) audio.startMusic();
  game.start();
  show(null);
}

function toMenu() {
  game.state = 'menu';
  game.world.reset(game.viewH);
  game.camX = 0;
  game.dragon.reset(game.viewW * C.DRAGON_X, game.viewH / 2);
  audio.stopMusic();
  showTitle();
}

function pause() {
  if (game.state !== 'playing') return;
  game.pausedFrom = game.state;
  game.state = 'paused';
  input.releaseAll();
  show('pause');
}

function resume() {
  if (game.state !== 'paused') return;
  game.state = game.pausedFrom || 'playing';
  show(null);
}

$('btn-play').addEventListener('click', () => { audio.uiTap(); startRun(); });
$('btn-retry').addEventListener('click', () => { audio.uiTap(); startRun(); });
$('btn-menu').addEventListener('click', () => { audio.uiTap(); toMenu(); });
btnPause.addEventListener('click', (e) => { e.stopPropagation(); audio.uiTap(); pause(); });
$('btn-resume').addEventListener('click', () => { audio.uiTap(); resume(); });
$('btn-quit').addEventListener('click', () => { audio.uiTap(); game.finish(); showGameOver(); });

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// --- settings ----------------------------------------------------------
function toggle(id, key, onChange) {
  const el = $(id);
  const apply = () => {
    const v = !!save.get(key);
    el.setAttribute('aria-pressed', String(v));
    onChange?.(v);
  };
  el.addEventListener('click', () => {
    save.set(key, !save.get(key));
    apply();
    audio.unlock();
    audio.uiTap();
  });
  apply();
}
toggle('tg-sound', 'sound', (v) => {
  audio.setEnabled(v);
  if (!v) audio.stopMusic();
  else if (game.state === 'playing') audio.startMusic();
});
toggle('tg-haptics', 'haptics');
toggle('tg-lefty', 'lefty', (v) => document.body.classList.toggle('lefty', v));

// --- loop --------------------------------------------------------------
let last = performance.now();
let wasOver = false;
let lastBiome = -1;

function frameLoop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;

  if (input.anyPressSinceCheck) {
    input.anyPressSinceCheck = false;
    audio.unlock();
  }

  if (game.state !== 'paused') {
    if (input.firing) game.fire();
    if (input.consumeRage()) game.useRage();
    else input.rageQueued = false;
    game.update(dt, input.flying);
  }

  if (game.biomeIndex !== lastBiome) {
    lastBiome = game.biomeIndex;
    audio.setBiome(lastBiome);
  }

  const d = game.dragon;
  btnFire.classList.toggle('dry', d.ember < C.EMBER_COST && !d.raging);
  const ready = d.rage >= C.RAGE_MAX && !d.raging;
  btnRage.classList.toggle('ready', ready);
  btnRage.classList.toggle('active', d.raging);
  btnRage.disabled = !ready;

  renderer.draw(game);

  if (game.state === 'gameover' && !wasOver) {
    wasOver = true;
    audio.stopMusic();
    showGameOver();
  }
  if (game.state !== 'gameover') wasOver = false;

  requestAnimationFrame(frameLoop);
}

toMenu();
requestAnimationFrame(frameLoop);

// Debug handle for tooling and screenshots: opt in with ?debug in the URL.
if (new URLSearchParams(location.search).has('debug')) {
  window.emberwing = { game, renderer, input, audio, save, config: C };
}

// --- PWA ---------------------------------------------------------------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' }).catch(() => {});
  });
}
