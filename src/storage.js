/** localStorage wrapper that never throws (private mode, disabled storage, ...). */

const KEY = 'emberwing.save.v1';

const DEFAULTS = {
  best: 0,
  bestDistance: 0,
  totalGems: 0,
  runs: 0,
  sound: true,
  haptics: true,
  lefty: false,
  seenTutorial: false,
};

let cache = null;

function read() {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(cache, JSON.parse(raw));
  } catch {
    /* storage unavailable: run with in-memory defaults */
  }
  return cache;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export const save = {
  get(key) {
    return read()[key];
  },
  set(key, value) {
    read()[key] = value;
    write();
  },
  patch(obj) {
    Object.assign(read(), obj);
    write();
  },
  all() {
    return { ...read() };
  },
};
