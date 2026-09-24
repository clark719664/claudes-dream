// Unified input: keyboard + mouse (pointer lock), touch (virtual joystick,
// look-drag and buttons) and gamepads, exposed as simple game actions.

export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressed = new Set();
    this.look = [0, 0];
    this.move = [0, 0];
    this.touchMove = [0, 0];
    this.touchJump = false;
    this.touchSprint = false;
    this.enabled = true;
    this.sensitivity = 0.0022;
    this.listeners = [];
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); this.listeners.push([target, type, fn, opts]); };
    on(window, 'keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && this.enabled && this.captured) e.preventDefault();
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    on(document, 'mousemove', (e) => {
      if (document.pointerLockElement === element) { this.look[0] += e.movementX; this.look[1] += e.movementY; }
      else if (this.dragging) { this.look[0] += e.movementX; this.look[1] += e.movementY; }
    });
    on(element, 'mousedown', (e) => { if (e.button === 2 || e.button === 0) this.dragging = !this.pointerLockAllowed; });
    on(window, 'mouseup', () => { this.dragging = false; });
    on(element, 'contextmenu', (e) => e.preventDefault());
    this.pointerLockAllowed = !matchMedia('(pointer: coarse)').matches;
  }

  get captured() { return document.pointerLockElement === this.element; }

  requestPointerLock() {
    if (!this.pointerLockAllowed) return;
    try { const p = this.element.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* not allowed (iframe etc.) */ }
  }
  exitPointerLock() { if (this.captured) document.exitPointerLock(); }

  /** Build on-screen controls for touch devices. */
  attachTouchControls(root) {
    const pad = document.createElement('div');
    pad.className = 'rv-touch';
    pad.innerHTML = `
      <div class="rv-stick"><div class="rv-knob"></div></div>
      <button class="rv-btn rv-jump" aria-label="Jump">⤒</button>
      <button class="rv-btn rv-run" aria-label="Sprint">»</button>`;
    root.appendChild(pad);
    const stick = pad.querySelector('.rv-stick');
    const knob = pad.querySelector('.rv-knob');
    let stickId = null, lookId = null, lookLast = null, center = null;
    const radius = 46;
    const setKnob = (x, y) => { knob.style.transform = `translate(${x}px, ${y}px)`; };
    this.element.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const rect = stick.getBoundingClientRect();
        if (stickId === null && t.clientX < window.innerWidth * 0.45) {
          stickId = t.identifier;
          center = [rect.left + rect.width / 2, rect.top + rect.height / 2];
        } else if (lookId === null) {
          lookId = t.identifier;
          lookLast = [t.clientX, t.clientY];
        }
      }
    }, { passive: true });
    this.element.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - center[0], dy = t.clientY - center[1];
          const l = Math.hypot(dx, dy);
          if (l > radius) { dx *= radius / l; dy *= radius / l; }
          setKnob(dx, dy);
          this.touchMove = [dx / radius, -dy / radius];
        } else if (t.identifier === lookId) {
          this.look[0] += (t.clientX - lookLast[0]) * 1.6;
          this.look[1] += (t.clientY - lookLast[1]) * 1.6;
          lookLast = [t.clientX, t.clientY];
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.touchMove = [0, 0]; setKnob(0, 0); }
        if (t.identifier === lookId) lookId = null;
      }
    };
    this.element.addEventListener('touchend', end);
    this.element.addEventListener('touchcancel', end);
    const hold = (btn, flag) => {
      btn.addEventListener('touchstart', (e) => { this[flag] = true; if (flag === 'touchJump') this.pressed.add('TouchJump'); e.preventDefault(); e.stopPropagation(); }, { passive: false });
      btn.addEventListener('touchend', (e) => { this[flag] = false; e.preventDefault(); }, { passive: false });
    };
    hold(pad.querySelector('.rv-jump'), 'touchJump');
    hold(pad.querySelector('.rv-run'), 'touchSprint');
    this.touchUI = pad;
  }

  /** Poll gamepads and combine every source. Call once per frame. */
  update() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    x += this.touchMove[0];
    y += this.touchMove[1];
    this.gamepadJump = false;
    this.gamepadSprint = false;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      x += dz(pad.axes[0] ?? 0);
      y -= dz(pad.axes[1] ?? 0);
      this.look[0] += dz(pad.axes[2] ?? 0) * 14;
      this.look[1] += dz(pad.axes[3] ?? 0) * 14;
      if (pad.buttons[0]?.pressed) { if (!this.padJumpHeld) this.pressed.add('PadJump'); this.gamepadJump = true; }
      this.padJumpHeld = !!pad.buttons[0]?.pressed;
      this.gamepadSprint = !!(pad.buttons[10]?.pressed || pad.buttons[7]?.pressed);
    }
    const l = Math.hypot(x, y);
    this.move = l > 1 ? [x / l, y / l] : [x, y];
  }

  get jumpPressed() { return this.pressed.has('Space') || this.pressed.has('TouchJump') || this.pressed.has('PadJump'); }
  get jumpHeld() { return this.keys.has('Space') || this.touchJump || this.gamepadJump; }
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint || this.gamepadSprint; }
  wasPressed(code) { return this.pressed.has(code); }

  consumeLook() {
    const l = [this.look[0] * this.sensitivity, this.look[1] * this.sensitivity];
    this.look[0] = 0; this.look[1] = 0;
    return l;
  }

  /** Clear one-frame edges. Call at the end of each frame. */
  endFrame() { this.pressed.clear(); }

  destroy() {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.touchUI?.remove();
  }
}
