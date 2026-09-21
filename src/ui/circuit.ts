import { sfx } from '../core/audio';
import { haptics } from '../core/haptics';
import {
  MAX_CHARGES,
  NODES,
  SECTORS,
  originDividend,
  resolveNode,
  type Payout,
  type SectorSpec,
} from '../meta/circuit';
import {
  addCharges,
  addLumens,
  addShards,
  currentSector,
  msToNextCharge,
  profile,
  queuePack,
  regenerateCharges,
  saveProfile,
} from '../meta/profile';
import { esc, fmt, mount, on, toast } from './dom';

/**
 * The Circuit screen.
 *
 * Drawn as a ring of light nodes rather than a bordered board with corners —
 * partly because it suits a game about prisms, and partly to keep well clear of
 * anyone else's board design. See docs/IP_NOTES.md.
 */
/** Node glyphs are tinted by type, so the ring reads without being studied. */
const NODE_TINT: Record<string, string> = {
  origin: '#ffffff',
  cache: '#8ae3ff',
  vault: '#ffd978',
  surge: '#b5e848',
  relay: '#e2b8ff',
  pack: '#ff8fa3',
  prism: '#ffffff',
  drain: '#5a6478',
};

let onBack: () => void = () => {};
let rolling = false;

export function initCircuit(back: () => void): void {
  onBack = back;
}

function ringPoint(index: number, total: number, rx: number, ry: number) {
  // Start at the bottom and travel clockwise, so the Origin sits under the
  // player's thumb and progress reads left-to-right across the top.
  const a = Math.PI / 2 + (index / total) * Math.PI * 2;
  return { x: 50 + Math.cos(a) * rx, y: 50 + Math.sin(a) * ry };
}

function ringSvg(sector: SectorSpec, position: number, moving: number | null): string {
  const total = sector.ring.length;
  const nodes = sector.ring
    .map((kind, i) => {
      const { x, y } = ringPoint(i, total, 38, 40);
      const spec = NODES[kind];
      const tint = NODE_TINT[kind];
      const here = i === position;
      const isNext = moving !== null && i === moving;
      const r = kind === 'origin' ? 6.4 : here || isNext ? 6 : 4.6;
      return `<g class="node ${here ? 'here' : ''}">
        <circle cx="${x}" cy="${y}" r="${r}"
                fill="${here ? sector.accent : 'rgba(255,255,255,0.09)'}"
                stroke="${here ? '#fff' : 'rgba(255,255,255,0.22)'}" stroke-width="0.7"/>
        <text x="${x}" y="${y + 1.9}" text-anchor="middle" font-size="5"
              fill="${here ? '#07091a' : tint}">${spec.icon}</text>
      </g>`;
    })
    .join('');

  const path = sector.ring
    .map((_, i) => {
      const { x, y } = ringPoint(i, total, 38, 40);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const at = ringPoint(position, total, 38, 40);
  return `<svg viewBox="0 0 100 100" class="circuit-ring" aria-hidden="true">
    <path d="${path} Z" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.8"/>
    ${nodes}
    <circle cx="${at.x}" cy="${at.y}" r="9" fill="none"
            stroke="${sector.accent}" stroke-width="1.1" opacity="0.65"/>
  </svg>`;
}

export function circuitScreen(flash?: string): void {
  regenerateCharges();

  if (profile.sector >= SECTORS.length) {
    return mount(
      `
      <h2 class="screen-title">Circuit complete</h2>
      <p class="sub">Every Beacon in every Sector is lit. More Sectors are on the way.</p>
      <div class="wallet">
        <div><span>Lumens</span><b>${fmt(profile.lumens)}</b></div>
        <div><span>Charges</span><b>${profile.charges}</b></div>
      </div>
      <button class="btn ghost" data-act="back">← Back</button>
    `,
      (root) => on(root, '[data-act="back"]', onBack),
      true,
    );
  }

  const sector = currentSector();
  const nextBeacon = sector.beacons[profile.beacons];
  const here = NODES[sector.ring[profile.node]];
  const wait = msToNextCharge();
  const mins = Math.ceil(wait / 60000);

  mount(
    `
    <p class="sub" style="margin-bottom:4px">Sector ${profile.sector + 1} of ${SECTORS.length}</p>
    <h2 class="screen-title" style="color:${sector.accent}">${esc(sector.name)}</h2>

    <div class="circuit-wrap">
      ${ringSvg(sector, profile.node, null)}
      <div class="circuit-centre">
        <b>${here.icon}</b>
        <span>${esc(here.label)}</span>
        <small>${esc(here.blurb)}</small>
      </div>
    </div>

    ${flash ? `<div class="hint payout">${flash}</div>` : ''}

    <div class="wallet">
      <div><span>Lumens</span><b>${fmt(profile.lumens)}</b></div>
      <div><span>Charges</span><b>${profile.charges}<small style="font-size:11px;color:var(--muted)">/${MAX_CHARGES}</small></b></div>
    </div>
    <p class="sub" style="margin:-8px 0 14px;font-size:12px">
      ${
        profile.charges >= MAX_CHARGES
          ? 'Charge meter full.'
          : `+1 Charge in ${mins} min${mins === 1 ? '' : 's'} · or win them by playing.`
      }
    </p>

    <button class="btn primary" data-act="surge" ${profile.charges > 0 && !rolling ? '' : 'disabled'}>
      ⚡  SURGE ${profile.primed ? '<span class="badge gold">PRIMED ×2</span>' : ''}
    </button>
    ${
      profile.charges === 0
        ? '<button class="btn gold" data-act="play">▶ Play a level to earn Charges</button>'
        : ''
    }

    <div class="set-card">
      <div class="set-head">
        <h3>Beacons</h3>
        <span class="count">${profile.beacons}/${sector.beacons.length} lit</span>
      </div>
      <div class="bar"><i style="width:${(profile.beacons / sector.beacons.length) * 100}%;background:${sector.accent}"></i></div>
      ${sector.beacons
        .map((b, i) => {
          const lit = i < profile.beacons;
          const isNext = i === profile.beacons;
          const afford = profile.lumens >= b.cost;
          return `<div class="row ${lit ? '' : isNext ? '' : 'dim'}">
            <span style="font-size:20px;width:26px;text-align:center">${lit ? '🔆' : '○'}</span>
            <div class="grow"><b>${esc(b.name)}</b>
              <small>${lit ? 'Lit' : `${fmt(b.cost)} Lumens`}</small></div>
            ${
              isNext
                ? `<button data-build ${afford ? '' : 'disabled'} style="${afford ? `background:${sector.accent};color:#07091a;border-color:transparent` : ''}">Raise</button>`
                : ''
            }
          </div>`;
        })
        .join('')}
      ${
        nextBeacon && profile.lumens < nextBeacon.cost
          ? `<p class="sub" style="margin:10px 0 0;font-size:12px">${fmt(nextBeacon.cost - profile.lumens)} more Lumens for ${esc(nextBeacon.name)}.</p>`
          : ''
      }
    </div>

    <button class="btn ghost" data-act="back">← Back</button>
  `,
    (root) => {
      on(root, '[data-act="back"]', () => {
        sfx.uiTap();
        onBack();
      });
      on(root, '[data-act="play"]', () => {
        sfx.uiTap();
        onBack();
      });
      on(root, '[data-act="surge"]', () => void surge());
      on(root, '[data-build]', () => raiseBeacon());
    },
    true,
  );
}

/** Spend a Charge, travel, and collect. */
async function surge(): Promise<void> {
  if (rolling || profile.charges <= 0) return;
  rolling = true;
  profile.charges--;
  sfx.launch();
  haptics.tap();

  const sector = currentSector();
  const steps = 1 + Math.floor(Math.random() * 6);
  let landed = profile.node;

  // Walk node by node so the move is legible rather than a teleport.
  for (let i = 0; i < steps; i++) {
    landed = (landed + 1) % sector.ring.length;
    profile.node = landed;
    if (landed === 0) addLumens(originDividend(sector));
    circuitScreen(`Surge ${steps} · travelling…`);
    sfx.uiTap();
    await sleep(110);
  }

  const total = collect(sector, landed, 0);
  rolling = false;
  saveProfile();
  circuitScreen(total);
}

/** Apply a node's payout, following any Relay it hands out. */
function collect(sector: SectorSpec, index: number, depth: number): string {
  const kind = sector.ring[index];
  const payout: Payout = resolveNode(
    kind,
    sector,
    () => 1 + Math.floor(Math.random() * 6),
    profile.primed,
    profile.lumens,
  );
  const wasPrimed = profile.primed;
  profile.primed = payout.primes;

  const bits: string[] = [];
  if (payout.lumens) {
    addLumens(payout.lumens);
    bits.push(`${payout.lumens > 0 ? '+' : ''}${fmt(payout.lumens)} Lumens`);
  }
  if (payout.shards) {
    addShards(payout.shards);
    bits.push(`+${fmt(payout.shards)} Shards`);
  }
  if (payout.charges) {
    addCharges(payout.charges);
    bits.push(`+${payout.charges} Charges`);
  }
  if (payout.pack) {
    queuePack('standard', `${sector.name} signal`);
    bits.push('a sticker pack');
  }
  if (payout.primes) bits.push('next landing pays double');

  if (payout.lumens > 0 || payout.charges || payout.pack) {
    sfx.pickup();
    haptics.reward();
  } else if (payout.lumens < 0) {
    sfx.gameOver();
    haptics.tap();
  }

  let text = `<b>${NODES[kind].icon} ${esc(payout.text)}</b>${wasPrimed ? ' <span class="badge gold">×2</span>' : ''} — ${bits.join(' · ') || 'nothing here'}`;

  // A Relay throws you on, and wherever it lands also pays. Bounded so a chain
  // of relays cannot loop forever.
  if (payout.advance > 0 && depth < 3) {
    const next = (index + payout.advance) % sector.ring.length;
    if (next < index) addLumens(originDividend(sector));
    profile.node = next;
    text += `<br />→ thrown ${payout.advance} on. ` + collect(sector, next, depth + 1);
  }
  return text;
}

function raiseBeacon(): void {
  const sector = currentSector();
  const beacon = sector.beacons[profile.beacons];
  if (!beacon || profile.lumens < beacon.cost) return;

  profile.lumens -= beacon.cost;
  profile.beacons++;
  sfx.setComplete();
  haptics.reward();

  if (profile.beacons >= sector.beacons.length) {
    profile.sector++;
    profile.sectorsDone++;
    profile.beacons = 0;
    profile.node = 0;
    profile.primed = false;
    addCharges(8);
    queuePack('premium', `${sector.name} complete`);
    saveProfile();
    toast(`${sector.name} is lit! A Prismatic pack and 8 Charges.`, 3600);
    circuitScreen(`<b>🔆 ${esc(sector.name)} complete.</b> On to the next Sector.`);
    return;
  }

  saveProfile();
  circuitScreen(`<b>🔆 ${esc(beacon.name)} raised.</b> ${sector.beacons.length - profile.beacons} to go.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
