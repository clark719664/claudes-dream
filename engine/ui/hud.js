// In-game HUD: score, lives, timer, objective, toasts, title card and
// end-of-game panels. Pure DOM, styled with CSS injected once.

const CSS = `
.rv-hud { position: absolute; inset: 0; pointer-events: none; font-family: "Inter", system-ui, sans-serif; color: #fff; user-select: none; -webkit-user-select: none; }
.rv-hud * { box-sizing: border-box; }
.rv-hud [hidden] { display: none !important; }
.rv-top { position: absolute; top: 14px; left: 14px; right: 14px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.rv-pill { background: rgba(10, 12, 20, 0.45); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.14); border-radius: 999px; padding: 7px 14px; font-weight: 650; font-size: 15px; letter-spacing: 0.01em; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.25); }
.rv-pill small { opacity: 0.7; font-weight: 500; }
.rv-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.rv-hearts { letter-spacing: 2px; color: #ff5a7a; }
.rv-objective { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); max-width: min(560px, 90%); text-align: center; font-size: 14px; opacity: 0; transition: opacity .5s; }
.rv-objective.show { opacity: 1; }
.rv-toast { position: absolute; left: 50%; top: 32%; transform: translate(-50%, -50%); font-size: 28px; font-weight: 800; text-shadow: 0 2px 16px rgba(0,0,0,0.5); opacity: 0; transition: opacity .3s, transform .3s; }
.rv-toast.show { opacity: 1; transform: translate(-50%, -60%); }
.rv-float { position: absolute; font-weight: 800; font-size: 20px; color: #ffe27a; text-shadow: 0 2px 8px rgba(0,0,0,.6); animation: rv-rise 0.9s ease-out forwards; }
@keyframes rv-rise { from { opacity: 1; transform: translate(-50%, 0) scale(1.1); } to { opacity: 0; transform: translate(-50%, -50px) scale(0.9); } }
.rv-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(460px, 92%); text-align: center; padding: 28px 26px 22px; border-radius: 22px; background: rgba(12, 14, 24, 0.55); backdrop-filter: blur(18px) saturate(1.3); -webkit-backdrop-filter: blur(18px) saturate(1.3); border: 1px solid rgba(255,255,255,0.16); box-shadow: 0 20px 60px rgba(0,0,0,0.45); pointer-events: auto; transition: opacity .35s, transform .35s; }
.rv-card.hidden { opacity: 0; transform: translate(-50%, -46%); pointer-events: none; }
.rv-card h1 { margin: 0 0 6px; font-size: clamp(24px, 5vw, 34px); line-height: 1.1; font-weight: 850; letter-spacing: -0.02em; }
.rv-card p { margin: 0 0 18px; opacity: 0.85; font-size: 15px; line-height: 1.45; }
.rv-card .rv-meta { font-size: 13px; opacity: 0.7; margin-top: 12px; }
.rv-btn-play { pointer-events: auto; cursor: pointer; border: 0; border-radius: 999px; padding: 13px 30px; font: 750 16px/1 inherit; font-family: inherit; color: #111; background: linear-gradient(135deg, #fff, #ffe7b0); box-shadow: 0 8px 30px rgba(255, 200, 120, 0.35); transition: transform .15s; }
.rv-btn-play:hover { transform: translateY(-1px) scale(1.03); }
.rv-btn-next { margin-left: 8px; background: linear-gradient(135deg, #d8f0ff, #b9a8ff); box-shadow: 0 8px 30px rgba(160, 140, 255, 0.35); }
.rv-btn-play:disabled { opacity: 0.6; cursor: default; transform: none; }
.rv-crosshair { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: rgba(255,255,255,0.8); box-shadow: 0 0 6px rgba(0,0,0,.6); display: none; }
.rv-touch { position: absolute; inset: 0; pointer-events: none; display: none; }
@media (pointer: coarse) { .rv-touch { display: block; } }
.rv-stick { position: absolute; left: 28px; bottom: 34px; width: 120px; height: 120px; border-radius: 50%; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.25); }
.rv-knob { position: absolute; left: 35px; top: 35px; width: 50px; height: 50px; border-radius: 50%; background: rgba(255,255,255,0.35); }
.rv-btn { position: absolute; pointer-events: auto; width: 74px; height: 74px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.35); background: rgba(255,255,255,0.14); color: #fff; font-size: 28px; }
.rv-jump { right: 30px; bottom: 40px; }
.rv-run { right: 116px; bottom: 26px; width: 58px; height: 58px; font-size: 22px; }
.rv-flash-hint { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); font-size: 12px; opacity: 0.65; white-space: nowrap; }
@media (pointer: coarse) { .rv-flash-hint { display: none; } }
`;

export class HUD {
  constructor(root) {
    if (!document.getElementById('rv-hud-css')) {
      const style = document.createElement('style');
      style.id = 'rv-hud-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'rv-hud';
    this.root.innerHTML = `
      <div class="rv-top" hidden>
        <div class="rv-stats">
          <span class="rv-pill rv-score">★ <b>0</b></span>
          <span class="rv-pill rv-hearts"></span>
        </div>
        <span class="rv-pill rv-timer" hidden>⏱ <b>0</b></span>
      </div>
      <div class="rv-objective rv-pill"></div>
      <div class="rv-toast"></div>
      <div class="rv-crosshair"></div>
      <div class="rv-card rv-title">
        <h1></h1><p></p>
        <button class="rv-btn-play">▶ Play</button>
        <button class="rv-btn-play rv-btn-next" hidden>✨ Next level</button>
        <div class="rv-meta"></div>
      </div>
      <div class="rv-flash-hint" hidden>WASD move · Space jump · Shift sprint · Mouse look · Esc pause</div>`;
    root.appendChild(this.root);
    this.$ = (s) => this.root.querySelector(s);
    this.onPlay = null;
    this.$('.rv-btn-play').addEventListener('click', (e) => { e.stopPropagation(); this.onPlay?.(); });
    this.$('.rv-btn-next').addEventListener('click', (e) => { e.stopPropagation(); this.onNext?.(); });
  }

  titleCard(spec, { button = '▶ Play', meta = '' } = {}) {
    this.$('.rv-btn-next').hidden = true;
    this.$('.rv-title h1').textContent = spec.title;
    this.$('.rv-title p').textContent = spec.tagline;
    this.$('.rv-btn-play').textContent = button;
    this.$('.rv-title .rv-meta').textContent = meta || spec.rules.objective;
    this.$('.rv-title').classList.remove('hidden');
    this.$('.rv-top').hidden = true;
    this.$('.rv-flash-hint').hidden = true;
    this.$('.rv-crosshair').style.display = 'none';
  }

  endCard(title, message, meta, button = '↻ Play again', next = false) {
    this.$('.rv-title h1').textContent = title;
    this.$('.rv-title p').textContent = message;
    this.$('.rv-btn-play').textContent = button;
    const n = this.$('.rv-btn-next');
    n.hidden = !next;
    n.disabled = false;
    n.textContent = '✨ Next level';
    this.$('.rv-title .rv-meta').textContent = meta;
    this.$('.rv-title').classList.remove('hidden');
  }

  hideCard() { this.$('.rv-title').classList.add('hidden'); }

  /** While the game master works: disable the button and show progress in the card. */
  nextLevelBusy(text) {
    const n = this.$('.rv-btn-next');
    n.disabled = true;
    n.textContent = '✨ Designing…';
    this.$('.rv-title .rv-meta').textContent = text;
  }

  playing(data, firstPerson) {
    this.hideCard();
    this.$('.rv-top').hidden = false;
    this.$('.rv-flash-hint').hidden = false;
    setTimeout(() => { this.$('.rv-flash-hint').hidden = true; }, 6000);
    this.$('.rv-crosshair').style.display = firstPerson ? 'block' : 'none';
    const obj = this.$('.rv-objective');
    obj.textContent = data.objective;
    obj.classList.add('show');
    clearTimeout(this.objTimer);
    this.objTimer = setTimeout(() => obj.classList.remove('show'), 5000);
    this.update(data);
  }

  update(d) {
    const scoreText = d.goal === 'collect' && d.target ? `${d.score}<small> / ${d.target}</small>` : `${d.score}`;
    this.$('.rv-score b').innerHTML = scoreText;
    const hearts = '♥'.repeat(Math.max(0, d.lives)) + '<span style="opacity:.25">' + '♥'.repeat(Math.max(0, d.maxLives - d.lives)) + '</span>';
    this.$('.rv-hearts').innerHTML = hearts;
    const timer = this.$('.rv-timer');
    timer.hidden = d.timeLeft === null;
    if (d.timeLeft !== null) {
      const t = Math.ceil(d.timeLeft);
      timer.querySelector('b').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      timer.style.color = t <= 10 ? '#ff8a7a' : '';
    }
  }

  toast(text, ms = 1400) {
    const t = this.$('.rv-toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  floatText(text, x, y) {
    const el = document.createElement('div');
    el.className = 'rv-float';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  destroy() { this.root.remove(); }
}
