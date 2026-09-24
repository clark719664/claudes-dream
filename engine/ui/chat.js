// Conversation UI for talking characters: floating nameplates, a "talk"
// hint, the chat panel (typed or spoken), and a waypoint marker for beacons.
// Characters can also speak their lines aloud with the browser's voices.

const CSS = `
.rv-chat { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(560px, 94%); pointer-events: auto; border-radius: 18px; background: rgba(12, 14, 24, 0.62); backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3); border: 1px solid rgba(255,255,255,0.16); box-shadow: 0 16px 50px rgba(0,0,0,0.45); overflow: hidden; }
.rv-chat-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.rv-chat-head b { font-size: 15px; }
.rv-chat-head small { opacity: 0.6; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rv-chat-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: 0 0 10px currentColor; }
.rv-chat-icon { border: 0; background: rgba(255,255,255,0.08); color: #fff; width: 30px; height: 30px; border-radius: 9px; cursor: pointer; font-size: 14px; flex: none; }
.rv-chat-icon.on { background: rgba(255, 200, 120, 0.35); }
.rv-chat-log { max-height: min(34vh, 260px); overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 14.5px; line-height: 1.45; }
.rv-line { max-width: 88%; padding: 7px 11px; border-radius: 13px; white-space: pre-wrap; }
.rv-line.npc { align-self: flex-start; background: rgba(255,255,255,0.1); border-bottom-left-radius: 4px; }
.rv-line.player { align-self: flex-end; background: rgba(255, 190, 110, 0.28); border-bottom-right-radius: 4px; }
.rv-line.busy::after { content: "…"; animation: rv-dots 1s steps(3) infinite; display: inline-block; width: 1.2em; overflow: hidden; vertical-align: bottom; }
@keyframes rv-dots { from { width: 0.2em; } to { width: 1.2em; } }
.rv-action { align-self: center; font-size: 12.5px; padding: 4px 10px; border-radius: 999px; background: rgba(120, 200, 255, 0.18); border: 1px solid rgba(140, 210, 255, 0.35); }
.rv-chat-form { display: flex; gap: 6px; padding: 8px 10px 10px; }
.rv-chat-form input { flex: 1; min-width: 0; border: 1px solid rgba(255,255,255,0.18); background: rgba(0,0,0,0.3); color: #fff; border-radius: 11px; padding: 9px 12px; font: inherit; font-size: 14.5px; outline: none; }
.rv-chat-form input:focus { border-color: rgba(255, 200, 120, 0.7); }
.rv-chat-send { border: 0; border-radius: 11px; padding: 0 14px; font: 700 14px/1 inherit; font-family: inherit; background: linear-gradient(135deg, #fff, #ffe7b0); color: #111; cursor: pointer; }
.rv-mic.listening { background: rgba(255, 90, 90, 0.55); animation: rv-pulse 1s ease-in-out infinite; }
@keyframes rv-pulse { 50% { box-shadow: 0 0 0 6px rgba(255, 90, 90, 0.2); } }
.rv-nameplate { position: absolute; transform: translate(-50%, -100%); text-align: center; pointer-events: auto; cursor: pointer; white-space: nowrap; text-shadow: 0 1px 6px rgba(0,0,0,0.7); transition: opacity .2s; }
.rv-nameplate b { font-size: 14px; }
.rv-nameplate .rv-talk { display: block; margin-top: 4px; font-size: 12px; padding: 3px 9px; border-radius: 999px; background: rgba(12,14,24,0.55); border: 1px solid rgba(255,255,255,0.2); }
.rv-nameplate .rv-talk kbd { font: 700 11px/1 inherit; font-family: inherit; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.85); color: #111; margin-right: 4px; }
.rv-waypoint { position: absolute; width: 0; height: 0; pointer-events: none; }
.rv-waypoint i { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; transform: rotate(45deg); border: 2px solid #9ad8ff; background: rgba(120, 200, 255, 0.35); box-shadow: 0 0 14px rgba(120, 200, 255, 0.8); }
.rv-waypoint span { position: absolute; top: 14px; left: 0; transform: translateX(-50%); font-size: 12px; font-weight: 700; text-shadow: 0 1px 5px rgba(0,0,0,0.8); white-space: nowrap; }
.rv-waypoint.edge i { border-radius: 3px 50% 50% 50%; }
`;

const SpeechRecognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export class ChatUI {
  constructor(root) {
    if (!document.getElementById('rv-chat-css')) {
      const style = document.createElement('style');
      style.id = 'rv-chat-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'rv-chat';
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <div class="rv-chat-head"><span class="rv-chat-dot"></span><b></b><small></small>
        <button class="rv-chat-icon rv-voice" title="Read replies aloud">🔈</button>
        <button class="rv-chat-icon rv-close" title="Leave (Esc)">✕</button></div>
      <div class="rv-chat-log"></div>
      <form class="rv-chat-form"><input maxlength="300" placeholder="Say something…" autocomplete="off">
        <button type="button" class="rv-chat-icon rv-mic" title="Speak">🎤</button>
        <button type="submit" class="rv-chat-send">Send</button></form>`;
    root.appendChild(this.panel);
    this.$ = (s) => this.panel.querySelector(s);
    this.input = this.$('input');
    this.log = this.$('.rv-chat-log');
    this.plates = new Map();
    this.waypoint = document.createElement('div');
    this.waypoint.className = 'rv-waypoint';
    this.waypoint.hidden = true;
    this.waypoint.innerHTML = '<i></i><span></span>';
    root.appendChild(this.waypoint);
    this.speak = (() => { try { return localStorage.getItem('reverie.voice') === '1'; } catch { return false; } })();
    this.#syncVoice();

    this.$('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text || this.busy) return;
      this.input.value = '';
      this.onSend?.(text);
    });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.onClose?.(); } e.stopPropagation(); });
    this.$('.rv-close').addEventListener('click', (e) => { e.stopPropagation(); this.onClose?.(); });
    this.$('.rv-voice').addEventListener('click', (e) => {
      e.stopPropagation();
      this.speak = !this.speak;
      try { localStorage.setItem('reverie.voice', this.speak ? '1' : '0'); } catch { /* private mode */ }
      if (!this.speak) globalThis.speechSynthesis?.cancel();
      this.#syncVoice();
    });
    const mic = this.$('.rv-mic');
    if (!SpeechRecognition) mic.hidden = true;
    mic.addEventListener('click', (e) => { e.stopPropagation(); this.#listen(); });
    this.panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.onClose?.(); } });
    this.panel.addEventListener('click', (e) => e.stopPropagation());
    this.panel.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  get isOpen() { return !this.panel.hidden; }

  open(character, color) {
    this.character = character;
    this.log.innerHTML = '';
    this.$('.rv-chat-head b').textContent = character.name;
    this.$('.rv-chat-head small').textContent = character.spec.role;
    this.$('.rv-chat-dot').style.color = color;
    this.$('.rv-chat-dot').style.background = color;
    this.panel.hidden = false;
    setTimeout(() => this.input.focus(), 30);
  }

  close() {
    this.panel.hidden = true;
    this.recognition?.abort();
    globalThis.speechSynthesis?.cancel();
    this.input.blur();
  }

  addLine(who, text = '', busy = false) {
    const el = document.createElement('div');
    el.className = `rv-line ${who}${busy ? ' busy' : ''}`;
    el.textContent = text;
    this.log.appendChild(el);
    this.log.scrollTop = this.log.scrollHeight;
    return el;
  }

  appendTo(el, text) {
    el.textContent += text;
    this.log.scrollTop = this.log.scrollHeight;
  }

  finish(el) {
    el.classList.remove('busy');
    if (this.isOpen) this.input.focus();
    if (!el.textContent.trim()) el.textContent = '…';
    if (this.speak && el.classList.contains('npc')) this.#say(el.textContent, this.character);
  }

  addAction(text) {
    if (!text) return;
    const el = document.createElement('div');
    el.className = 'rv-action';
    el.textContent = `✦ ${text}`;
    this.log.appendChild(el);
    this.log.scrollTop = this.log.scrollHeight;
  }

  setBusy(b) {
    this.busy = b;
    this.$('.rv-chat-send').disabled = b;
  }

  /** plates: [{ key, name, x, y, near }] in CSS pixels; others are removed. */
  updateNameplates(plates, hint) {
    const seen = new Set();
    for (const p of plates) {
      seen.add(p.key);
      let el = this.plates.get(p.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'rv-nameplate';
        el.innerHTML = '<b></b><span class="rv-talk"></span>';
        el.addEventListener('click', (e) => { e.stopPropagation(); this.onPlateClick?.(p.key); });
        this.root.appendChild(el);
        this.plates.set(p.key, el);
      }
      el.querySelector('b').textContent = p.name;
      const talk = el.querySelector('.rv-talk');
      talk.hidden = !p.near;
      if (p.near) talk.innerHTML = `<kbd>E</kbd>${hint}`;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.opacity = String(p.alpha ?? 1);
    }
    for (const [key, el] of this.plates) if (!seen.has(key)) { el.remove(); this.plates.delete(key); }
  }

  /** w: { x, y, edge, label } in CSS pixels, or null to hide. */
  setWaypoint(w) {
    this.waypoint.hidden = !w;
    if (!w) return;
    this.waypoint.style.left = `${w.x}px`;
    this.waypoint.style.top = `${w.y}px`;
    this.waypoint.classList.toggle('edge', !!w.edge);
    this.waypoint.querySelector('span').textContent = w.label;
  }

  destroy() {
    this.close();
    this.panel.remove();
    this.waypoint.remove();
    for (const el of this.plates.values()) el.remove();
  }

  #syncVoice() {
    const b = this.$('.rv-voice');
    b.classList.toggle('on', this.speak);
    b.textContent = this.speak ? '🔊' : '🔈';
    b.hidden = !globalThis.speechSynthesis;
  }

  /** Each character gets a stable voice, pitch and pace derived from their name. */
  #say(text, character) {
    const synth = globalThis.speechSynthesis;
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    let h = 0;
    for (const ch of character?.name ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const voices = synth.getVoices().filter((v) => v.lang?.startsWith('en'));
    if (voices.length) u.voice = voices[h % voices.length];
    u.pitch = 0.7 + ((h >> 4) % 60) / 100;
    u.rate = 0.9 + ((h >> 10) % 25) / 100;
    synth.speak(u);
  }

  #listen() {
    if (!SpeechRecognition) return;
    if (this.recognition) { this.recognition.stop(); return; }
    const r = new SpeechRecognition();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.maxAlternatives = 1;
    const mic = this.$('.rv-mic');
    mic.classList.add('listening');
    let final = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      this.input.value = (final + interim).trim();
    };
    r.onend = () => {
      mic.classList.remove('listening');
      this.recognition = null;
      if (final.trim() && !this.busy) { this.input.value = ''; this.onSend?.(final.trim()); }
    };
    r.onerror = () => { mic.classList.remove('listening'); this.recognition = null; };
    this.recognition = r;
    r.start();
  }
}
