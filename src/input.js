/**
 * Touch/mouse/keyboard input.
 *
 * Control scheme (portrait, thumbs-only):
 *   hold anywhere  -> beat wings / climb, release to dive
 *   FIRE button    -> breathe fire (hold to stream while ember lasts)
 *   RAGE button    -> spend a full rage meter
 * Desktop mirrors it on Space / F / R so the game is playable on a laptop.
 */

export class Input {
  constructor(surface, buttons) {
    this.flyPointers = new Set();
    this.firePointers = new Set();
    this.keyFly = false;
    this.keyFire = false;
    this.rageQueued = false;
    this.anyPressSinceCheck = false;

    const isControl = (t) => t instanceof Element && t.closest('.ctl');

    surface.addEventListener('pointerdown', (e) => {
      if (isControl(e.target)) return;
      this.flyPointers.add(e.pointerId);
      this.anyPressSinceCheck = true;
    });
    const release = (e) => this.flyPointers.delete(e.pointerId);
    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
    surface.addEventListener('pointerleave', release);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());

    const bind = (el, set) => {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture?.(e.pointerId);
        set.add(e.pointerId);
        el.classList.add('held');
        this.anyPressSinceCheck = true;
      });
      const off = (e) => {
        set.delete(e.pointerId);
        if (set.size === 0) el.classList.remove('held');
      };
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
    };

    bind(buttons.fire, this.firePointers);

    if (buttons.rage) {
      buttons.rage.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.rageQueued = true;
        this.anyPressSinceCheck = true;
      });
    }

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { this.keyFly = true; e.preventDefault(); }
      if (e.code === 'KeyF' || e.code === 'KeyJ' || e.code === 'ArrowRight') { this.keyFire = true; e.preventDefault(); }
      if (e.code === 'KeyR' || e.code === 'ShiftLeft') { this.rageQueued = true; e.preventDefault(); }
      this.anyPressSinceCheck = true;
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') this.keyFly = false;
      if (e.code === 'KeyF' || e.code === 'KeyJ' || e.code === 'ArrowRight') this.keyFire = false;
    });
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }

  releaseAll() {
    this.flyPointers.clear();
    this.firePointers.clear();
    this.keyFly = false;
    this.keyFire = false;
  }

  get flying() { return this.flyPointers.size > 0 || this.keyFly; }
  get firing() { return this.firePointers.size > 0 || this.keyFire; }

  consumeRage() {
    const q = this.rageQueued;
    this.rageQueued = false;
    return q;
  }
}
