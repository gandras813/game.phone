# Emberwing

A one-thumb arcade flyer about a purple dragon, built for phones.

You are Emberwing, diving through an endless cave under the mountains. Hold the
screen to beat your wings, let go to dive, and breathe fire at whatever is in
the way — but ember is scarce, so every shot is a decision.

**No installs, no build step, no dependencies.** It is plain HTML, CSS and
JavaScript modules; every sprite is drawn with canvas paths and every sound is
synthesised with WebAudio, so the whole game is a few hundred kilobytes and
plays offline once loaded.

## Play

```bash
npm start          # serves on http://localhost:8080
```

Open it on your phone by connecting to the same Wi-Fi and visiting
`http://<your-machine-ip>:8080`. On Android or iOS, "Add to Home Screen"
installs it as a fullscreen app that works without a connection.

Pushing to `main` publishes it to GitHub Pages (see
`.github/workflows/pages.yml`); enable Pages with the "GitHub Actions" source
once, and the workflow does the rest.

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Fly | **hold anywhere** — release to dive | <kbd>Space</kbd> / <kbd>↑</kbd> |
| Breathe fire | **FIRE** button (hold to stream) | <kbd>F</kbd> / <kbd>J</kbd> |
| Dragon rage | **RAGE** button when it lights up | <kbd>R</kbd> |

Left-handed players can mirror the buttons from the title screen.

## How it plays

The cave asks a different question every few hundred metres, and the answer is
never just "dodge":

- **Wisps and crystals** can be burned *or* squeezed past. Burning them scores
  and builds rage; squeezing past saves ember.
- **Rune gates** span the tunnel and only open to fire. If you spent your ember
  on wisps, you take the gate with your face. (Gems are always seeded on the
  approach, so a gate is never an unwinnable wall.)
- **Stone spikes never burn.** Those you dodge, always.
- **Gems** refill ember and build a combo multiplier that climbs to ×5 —
  a combo dies the moment you take a hit, so the greedy line and the safe line
  genuinely differ.
- **Dragon rage** fills from kills and near misses. Five seconds of invincible,
  auto-firing, double-scoring flight: spend it to escape trouble, or hold it for
  a dense stretch and cash in.

Four biomes cycle as you descend — Amethyst Hollow, Ember Deep, Frost Vein and
The Void Reach. Frost Vein thins gravity; The Void Reach goes almost black, and
the cave walls read only as glowing veins at the edge of your firelight.

## Repository layout

```
index.html            markup, HUD controls, screens
styles.css            UI chrome (the game itself is canvas)
src/config.js         every tuning constant, in one place
src/world.js          procedural cave director and hazard placement
src/entities.js       dragon physics, particles, collision maths
src/game.js           rules: pacing, collisions, scoring, life cycle
src/render.js         all drawing, including the dragon's vector art
src/input.js          pointer/keyboard handling
src/audio.js          WebAudio synthesis for every sound and the ambient bed
src/main.js           bootstrap, screens, loop
sw.js                 offline cache
tools/sim.js          headless balance harness
tools/make_icons.py   regenerates the app icons
tools/dragon-preview.html   renders the dragon at several poses for art work
test/                 node:test suites for the simulation core
```

`config.js`, `rng.js`, `world.js`, `entities.js` and `game.js` never touch the
DOM, which is what lets the whole game be simulated and tested under node.

## Development

```bash
npm test                  # 31 tests over generation, physics, scoring, life cycle
npm run sim               # 24 headless runs; prints pacing and cause-of-death stats
node tools/sim.js 60 0.85 # 60 runs at a given pilot skill
npm run icons             # regenerate icons/ from tools/make_icons.py
```

The balance harness is the reason the numbers in `config.js` are what they are.
It flies scripted runs through the real game loop and reports median survival,
distance, score and what actually killed the pilot — so pacing changes get
measured instead of guessed. A healthy build looks roughly like:

```
survival   median 27s
distance   median 650 m
hits by cause: spike 51  crystal 35  wisp 32  ceiling 24  floor 21  gate 17
```

If terrain dominates that list, the controls are fighting the player; if one
hazard dominates, that hazard is unfair.

Append `?debug` to the URL to expose `window.emberwing` with the live game,
renderer, input and audio objects.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
