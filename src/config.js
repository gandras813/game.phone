/**
 * Tunable constants for Emberwing.
 *
 * All gameplay maths happen in "world units" so the game plays identically on a
 * 4" phone and a 13" tablet. The virtual viewport is VIEW_W units wide; its
 * height is derived from the device aspect ratio and clamped so absurdly tall
 * or short windows stay fair.
 */

export const VIEW_W = 480;
export const MIN_RATIO = 1.28; // view height / view width
export const MAX_RATIO = 2.3;

// --- Terrain -----------------------------------------------------------
export const STEP = 24; // horizontal distance between terrain samples
export const WALL_MARGIN = 28; // terrain never leaves less than this at top/bottom

// --- Dragon ------------------------------------------------------------
export const DRAGON_X = 0.26; // fraction of VIEW_W the dragon sits at
export const DRAGON_R = 17; // forgiving collision radius
export const GRAVITY = 1700;
// Kept within ~1.5x of gravity so a climb can be arrested in roughly the
// distance it took to start. Run length is insensitive to this (see
// tools/sim.js); it is tuned for feel.
export const LIFT = -2500; // acceleration while the player holds the screen
export const VY_MAX_DOWN = 700;
export const VY_MAX_UP = 520;

// --- Pace --------------------------------------------------------------
export const SPEED_MIN = 178;
export const SPEED_MAX = 342;
export const RAMP_DISTANCE = 7000; // world units until peak difficulty

// --- Fire --------------------------------------------------------------
export const EMBER_MAX = 100;
export const EMBER_COST = 14;
export const EMBER_REGEN = 6.5; // per second
export const FIRE_COOLDOWN = 0.16;
export const FIRE_SPEED = 560; // relative to the camera
export const FIRE_LIFE = 0.85;

// --- Rage --------------------------------------------------------------
export const RAGE_MAX = 100;
export const RAGE_PER_KILL = 9;
export const RAGE_PER_SHATTER = 5;
export const RAGE_PER_GEM = 1.5;
export const RAGE_PER_NEAR_MISS = 2.5;
export const RAGE_DURATION = 5.0;

// --- Survival ----------------------------------------------------------
export const HEARTS_START = 3;
export const HEARTS_MAX = 4;
export const INVULN_TIME = 1.5;

// --- Scoring -----------------------------------------------------------
export const SCORE_PER_UNIT = 0.1; // distance -> score
export const SCORE_GEM = 15;
export const SCORE_KILL = 25;
export const SCORE_SHATTER = 12;
export const SCORE_NEAR_MISS = 3;
export const COMBO_STEP = 6; // combo hits needed per extra multiplier
export const COMBO_MAX_MULT = 5;

// --- Biomes ------------------------------------------------------------
// `dark` drives the fog-of-war lighting pass; `chill` lowers gravity slightly.
export const BIOME_LENGTH = 2600;
export const BIOMES = [
  {
    name: 'Amethyst Hollow',
    sky: ['#1a0d2e', '#2d1250'],
    rock: ['#3c1c63', '#22103c'],
    edge: '#b57bff',
    glow: '#c98bff',
    mote: '#d9a6ff',
    dark: 0.0,
    chill: 0,
  },
  {
    name: 'Ember Deep',
    sky: ['#2a0d18', '#59180f'],
    rock: ['#5d1e22', '#2a0c12'],
    edge: '#ff9a5c',
    glow: '#ff7a3c',
    mote: '#ffb782',
    dark: 0.34,
    chill: 0,
  },
  {
    name: 'Frost Vein',
    sky: ['#08202e', '#0d3b52'],
    rock: ['#123a52', '#08202e'],
    edge: '#8ce4ff',
    glow: '#7fd8ff',
    mote: '#c4f2ff',
    dark: 0.26,
    chill: 0.16,
  },
  {
    name: 'The Void Reach',
    sky: ['#07060f', '#120a24'],
    rock: ['#1b1030', '#080513'],
    edge: '#9d6bff',
    glow: '#8f5cff',
    mote: '#b79bff',
    dark: 0.82,
    chill: 0,
  },
];

// --- Dragon palette ----------------------------------------------------
export const DRAGON = {
  body: '#8b3fd6',
  bodyDark: '#4d1f80',
  bodyLight: '#c07bff',
  belly: '#f0c8ff',
  membrane: '#6d2bb0',
  membraneLight: '#a95ff0',
  crest: '#f0a2ff',
  horn: '#ffe4a8',
  eye: '#ffe066',
  flame: '#d38bff',
  flameHot: '#fff0ff',
};
