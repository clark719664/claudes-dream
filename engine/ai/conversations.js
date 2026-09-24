// Conversations with talking characters. Each character remembers what was
// said; replies stream in from Claude through the server (/api/npc), and the
// powers Claude uses arrive as actions that change the game. Without a
// server or API key, the offline brain in shared/npc.js answers instead.

import { postStream } from './stream.js';
import { offlineReply, validateAction } from '../../shared/npc.js';
import { ChatUI } from '../ui/chat.js';

export class Conversations {
  constructor(engine, { endpoint = '/api/npc' } = {}) {
    this.engine = engine;
    this.endpoint = endpoint;
    this.histories = new Map();
    this.ui = new ChatUI(engine.hud.root);
    this.ui.onSend = (text) => this.send(text);
    this.ui.onClose = () => this.close();
    this.ui.onPlateClick = (key) => {
      const c = engine.game?.characters.find((x) => x.index === key);
      if (c && engine.game.nearCharacter === c) this.open(c);
    };
    this.active = null;
  }

  get isOpen() { return this.ui.isOpen; }

  /** A new game: characters forget everything. */
  reset() {
    this.close();
    this.histories.clear();
  }

  open(character) {
    if (this.active) return;
    this.active = character;
    this.engine.input.exitPointerLock();
    const c = character.color;
    this.ui.open(character, `rgb(${[0, 1, 2].map((i) => Math.round(Math.min(1, Math.pow(c[i], 1 / 2.2)) * 255)).join(',')})`);
    const history = this.#history(character);
    if (!history.length) history.push({ role: 'assistant', text: character.spec.greeting });
    for (const h of history) this.ui.addLine(h.role === 'assistant' ? 'npc' : 'player', h.text);
    this.engine.emit('talk', { character: character.name, open: true });
  }

  close() {
    if (!this.active) return;
    this.controller?.abort();
    this.engine.emit('talk', { character: this.active.name, open: false });
    this.active = null;
    this.ui.close();
  }

  #history(c) {
    if (!this.histories.has(c.index)) this.histories.set(c.index, []);
    return this.histories.get(c.index);
  }

  async send(text) {
    const character = this.active;
    if (!character || this.ui.busy) return;
    const history = this.#history(character);
    const prior = history.slice();
    history.push({ role: 'user', text });
    this.ui.addLine('player', text);
    const line = this.ui.addLine('npc', '', true);
    this.ui.setBusy(true);
    const world = this.engine.describeWorld();
    let reply = '';
    const onText = (t) => { reply += t; this.ui.appendTo(line, t); };
    const onAction = (a) => {
      const checked = validateAction(a.name, a.input);
      if (!checked.ok || !character.spec.powers.includes(a.name)) return;
      const note = this.engine.applyCharacterAction(a.name, checked.input, character);
      this.ui.addAction(note);
    };
    this.controller = new AbortController();
    try {
      await postStream(this.endpoint, { character: character.spec, world, history: prior, message: text }, (type, data) => {
        if (type === 'text') onText(data.text);
        else if (type === 'action') onAction(data);
      }, { signal: this.controller.signal });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (!reply) {
        // no server (static hosting) or no connection: the offline brain answers
        const r = offlineReply(character.spec, world, text, prior);
        onText(r.text);
        for (const a of r.actions) onAction(a);
      }
    } finally {
      this.ui.setBusy(false);
      this.ui.finish(line);
      if (reply.trim()) history.push({ role: 'assistant', text: reply.trim() });
    }
  }

  /** Nameplates over characters near the camera, and the beacon waypoint. */
  updateOverlay() {
    const e = this.engine;
    const game = e.game;
    if (!game || game.state === 'attract') { this.ui.updateNameplates([], ''); this.ui.setWaypoint(null); return; }
    const plates = [];
    const cam = e.renderer.camera?.position ?? [0, 0, 0];
    for (const c of game.characters) {
      const d = Math.hypot(c.pos[0] - cam[0], c.pos[1] - cam[1], c.pos[2] - cam[2]);
      if (d > 45 || (this.active === c)) continue;
      const s = e.projectToScreen(c.pos, 2.35);
      if (!s) continue;
      plates.push({ key: c.index, name: c.name, x: s[0], y: s[1], near: game.nearCharacter === c && !this.active, alpha: Math.min(1, (45 - d) / 10) });
    }
    this.ui.updateNameplates(plates, matchMedia?.('(pointer: coarse)').matches ? 'Tap to talk' : 'Talk');
    const b = game.beacon;
    if (!b) { this.ui.setWaypoint(null); return; }
    const p = game.player.pos;
    const dist = Math.round(Math.hypot(b.pos[0] - p[0], b.pos[2] - p[2]));
    this.ui.setWaypoint(e.projectToScreenEdge([b.pos[0], b.pos[1] + 1.5, b.pos[2]], `${dist} m`));
  }

  /** Who the player talked to and how much, for the game master. */
  summary() {
    const out = [];
    for (const [index, h] of this.histories) {
      const c = this.engine.game?.characters.find((x) => x.index === index);
      const lines = h.filter((x) => x.role === 'user').length;
      if (c && lines) out.push({ name: c.name, lines });
    }
    return out;
  }

  destroy() { this.ui.destroy(); }
}
