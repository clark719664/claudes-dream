import { PALETTE } from '../game/config';
import { sfx, isMuted, setMuted } from '../core/audio';
import { haptics } from '../core/haptics';
import {
  RARITY_COLOUR,
  RARITY_NAME,
  SETS,
  STICKERS_BY_ID,
  stickersInSet,
  type Sticker,
} from '../meta/stickers';
import {
  albumProgress,
  claimDaily,
  duplicatesOf,
  hasSticker,
  isSetComplete,
  pendingDaily,
  profile,
  resetProfile,
  saveProfile,
  setProgress,
  todayKey,
} from '../meta/profile';
import {
  buyPack,
  canAfford,
  canCraft,
  craft,
  craftCost,
  giftableStickers,
  mintGift,
  openPack,
  packCost,
  packSize,
  redeemGift,
  type PackKind,
  type PullResult,
} from '../meta/packs';
import { esc, fmt, mount, on, share, toast, unmount } from './dom';

export interface Nav {
  play: (daily: boolean) => void;
  resume: () => void;
  restart: () => void;
  home: () => void;
}

let nav: Nav;

export function initScreens(n: Nav): void {
  nav = n;
}

function wallet(): string {
  return `<div class="wallet">
    <div><span>Prism Shards</span><b>${fmt(profile.shards)}</b></div>
    <div><span>Dust</span><b>${fmt(profile.dust)}</b></div>
  </div>`;
}

// ------------------------------------------------------------------ home --
export function homeScreen(): void {
  const daily = pendingDaily();
  const album = albumProgress();
  const packs = profile.unopened.length;
  const todayBest = profile.dailyBest[todayKey()] ?? 0;

  mount(
    `
    <h1 class="title">PRISM<br />BREAK</h1>
    <p class="tagline">Chain the colours. Collapse the wall. Fill the album.</p>
    ${wallet()}
    ${
      daily
        ? `<button class="btn gold" data-act="daily-claim">
             🎁 Day ${daily.streak} reward — +${daily.shards} shards${daily.pack ? ' &amp; a pack' : ''}
           </button>`
        : ''
    }
    <button class="btn primary" data-act="play">▶  PLAY</button>
    <button class="btn" data-act="daily">
      ☀️  Daily Challenge ${todayBest ? `<span class="badge">best ${fmt(todayBest)}</span>` : '<span class="badge live">new</span>'}
    </button>
    <button class="btn" data-act="album">
      📖  Sticker Album <span class="badge">${album.owned}/${album.total}</span>
    </button>
    <button class="btn" data-act="shop">
      🎴  Packs ${packs ? `<span class="badge gold">${packs} to open</span>` : ''}
    </button>
    <button class="btn" data-act="gift">🤝  Gift &amp; Redeem</button>
    <div class="btn-row">
      <button class="btn ghost" data-act="help">How to play</button>
      <button class="btn ghost" data-act="settings">Settings</button>
    </div>
    <p class="sub" style="text-align:center;margin-top:10px">
      Best ${fmt(profile.bestScore)} · Wave ${profile.bestWave} · Chain ×${profile.bestChain}
    </p>
  `,
    (root) => {
      on(root, '[data-act]', (el) => {
        sfx.uiTap();
        haptics.tap();
        switch (el.dataset.act) {
          case 'play':
            nav.play(false);
            break;
          case 'daily':
            nav.play(true);
            break;
          case 'daily-claim': {
            const reward = claimDaily();
            if (reward) {
              haptics.reward();
              sfx.packOpen();
              toast(`Day ${reward.streak}: +${reward.shards} shards${reward.pack ? ' + a pack!' : ''}`);
            }
            homeScreen();
            break;
          }
          case 'album':
            albumScreen();
            break;
          case 'shop':
            shopScreen();
            break;
          case 'gift':
            giftScreen();
            break;
          case 'help':
            helpScreen();
            break;
          case 'settings':
            settingsScreen();
            break;
        }
      });
    },
    true,
  );
}

// ----------------------------------------------------------------- album --
export function albumScreen(): void {
  const album = albumProgress();
  const body = SETS.map((set) => {
    const prog = setProgress(set.id);
    const complete = isSetComplete(set.id);
    const pct = Math.round((prog.owned / prog.total) * 100);

    const tiles = stickersInSet(set.id)
      .map((st) => stickerTile(st))
      .join('');

    return `<section class="set-card">
      <div class="set-head">
        <h3 style="color:${set.accent}">${esc(set.name)}</h3>
        ${complete ? '<span class="badge gold">COMPLETE</span>' : ''}
        <span class="count">${prog.owned}/${prog.total}</span>
      </div>
      <div class="set-bonus ${complete ? 'done' : ''}">
        ${complete ? '★ Active: ' : 'Complete for: '}${esc(set.bonus.label)}
      </div>
      <div class="bar"><i style="width:${pct}%;background:${set.accent}"></i></div>
      <div class="sticker-grid">${tiles}</div>
    </section>`;
  }).join('');

  mount(
    `
    <h2 class="screen-title">Sticker Album</h2>
    <p class="sub">${album.owned} of ${album.total} collected — finish a page for a permanent perk.</p>
    ${body}
    <button class="btn ghost" data-act="back">← Back</button>
  `,
    (root) => {
      on(root, '[data-act="back"]', () => {
        sfx.uiTap();
        homeScreen();
      });
      on(root, '.sticker', (el) => {
        sfx.uiTap();
        const st = STICKERS_BY_ID.get(el.dataset.id ?? '');
        if (st) stickerDetail(st);
      });
    },
    true,
  );
}

function stickerTile(st: Sticker): string {
  const owned = hasSticker(st.id);
  const dupes = duplicatesOf(st.id);
  return `<button class="sticker ${owned ? 'owned' : 'locked'}" data-id="${esc(st.id)}">
    ${dupes ? `<span class="dupe">×${dupes + 1}</span>` : ''}
    <span class="glyph">${owned ? st.glyph : '❔'}</span>
    <span class="nm">${owned ? esc(st.name) : '???'}</span>
    <i class="rar" style="background:${RARITY_COLOUR[st.rarity]}"></i>
  </button>`;
}

function stickerDetail(st: Sticker): void {
  const owned = hasSticker(st.id);
  const dupes = duplicatesOf(st.id);
  const cost = craftCost(st.rarity);

  mount(
    `
    <div class="reveal">
      ${cardMarkup(st, owned)}
      <p class="pull-note">${
        owned
          ? `In your album${dupes ? ` — ${dupes} spare to gift` : ''}`
          : `Not collected yet · Craft for ${fmt(cost)} dust (you have ${fmt(profile.dust)})`
      }</p>
    </div>
    ${
      !owned
        ? `<button class="btn ${canCraft(st.id) ? 'gold' : ''}" data-act="craft" ${
            canCraft(st.id) ? '' : 'disabled'
          }>✦ Craft for ${fmt(cost)} dust</button>`
        : ''
    }
    ${dupes ? '<button class="btn" data-act="gift">🤝 Gift a spare</button>' : ''}
    <button class="btn ghost" data-act="back">← Album</button>
  `,
    (root) => {
      on(root, '[data-act="back"]', () => {
        sfx.uiTap();
        albumScreen();
      });
      on(root, '[data-act="craft"]', () => {
        if (craft(st.id)) {
          sfx.setComplete();
          haptics.reward();
          toast(`Crafted ${st.name}!`);
          albumScreen();
        }
      });
      on(root, '[data-act="gift"]', () => {
        sfx.uiTap();
        giftScreen(st.id);
      });
    },
    true,
  );
}

function cardMarkup(st: Sticker, revealed = true): string {
  const colour = RARITY_COLOUR[st.rarity];
  return `<div class="card" style="border-color:${colour};box-shadow:0 0 50px ${colour}40">
    ${st.rarity >= 4 && revealed ? '<div class="shine"></div>' : ''}
    <span class="glyph">${revealed ? st.glyph : '❔'}</span>
    <span class="nm">${revealed ? esc(st.name) : '???'}</span>
    <span class="rarity" style="color:${colour}">${'★'.repeat(st.rarity)} ${RARITY_NAME[st.rarity]}</span>
    ${revealed ? `<span class="flavour">“${esc(st.flavour)}”</span>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ shop --
export function shopScreen(): void {
  const queue = profile.unopened;
  mount(
    `
    <h2 class="screen-title">Packs</h2>
    <p class="sub">Shards come from every run. Duplicates melt into dust.</p>
    ${wallet()}
    ${
      queue.length
        ? `<div class="set-card">
             <div class="set-head"><h3>Waiting for you</h3><span class="count">${queue.length}</span></div>
             ${queue
               .map(
                 (p, i) => `<div class="row">
                   <span style="font-size:26px">${p.kind === 'premium' ? '💎' : '🎴'}</span>
                   <div class="grow"><b>${p.kind === 'premium' ? 'Prismatic' : 'Standard'} Pack</b>
                     <small>${esc(p.reason)}</small></div>
                   <button data-open="${i}">Open</button>
                 </div>`,
               )
               .join('')}
           </div>`
        : ''
    }
    <button class="btn ${canAfford('standard') ? '' : ''}" data-buy="standard" ${
      canAfford('standard') ? '' : 'disabled'
    }>
      🎴 Standard Pack — ${packSize('standard')} stickers · ${fmt(packCost('standard'))} shards
    </button>
    <button class="btn ${canAfford('premium') ? 'gold' : ''}" data-buy="premium" ${
      canAfford('premium') ? '' : 'disabled'
    }>
      💎 Prismatic Pack — ${packSize('premium')} stickers, one Epic+ · ${fmt(packCost('premium'))} shards
    </button>
    <div class="hint">
      <b>Odds.</b> Standard: ★1 55% · ★2 27% · ★3 13% · ★4 4.2% · ★5 0.8%, with at least one ★2+.
      Prismatic: ★3 30% · ★4 14% · ★5 4%, with at least one ★4+. Missing stickers are favoured.
    </div>
    <button class="btn ghost" data-act="back">← Back</button>
  `,
    (root) => {
      on(root, '[data-act="back"]', () => {
        sfx.uiTap();
        homeScreen();
      });
      on(root, '[data-buy]', (el) => {
        const kind = el.dataset.buy as PackKind;
        if (buyPack(kind)) {
          sfx.uiTap();
          shopScreen();
        }
      });
      on(root, '[data-open]', (el) => {
        const i = Number(el.dataset.open);
        const entry = profile.unopened[i];
        if (!entry) return;
        profile.unopened.splice(i, 1);
        saveProfile();
        openPackScreen(entry.kind, () => shopScreen());
      });
    },
    true,
  );
}

// ------------------------------------------------------------ pack open --
export function openPackScreen(kind: PackKind, done: () => void): void {
  const pulls = openPack(kind);
  sfx.packOpen();
  haptics.reward();
  let index = 0;

  const render = (): void => {
    const pull = pulls[index];
    const st = pull.sticker;
    mount(
      `
      <div class="reveal">
        ${cardMarkup(st)}
        <p class="pull-note ${pull.duplicate ? '' : 'new'}">
          ${pull.duplicate ? `Duplicate — +${pull.dust} dust` : '✦ NEW STICKER'}
        </p>
        ${
          pull.completedSet
            ? `<p class="pull-note new">🏆 ${esc(
                SETS.find((s) => s.id === pull.completedSet)?.name ?? '',
              )} complete — ${esc(
                SETS.find((s) => s.id === pull.completedSet)?.bonus.label ?? '',
              )}</p>`
            : ''
        }
        <div class="dots">${pulls
          .map((_, i) => `<i class="${i <= index ? 'on' : ''}"></i>`)
          .join('')}</div>
      </div>
      <button class="btn primary" data-act="next">
        ${index < pulls.length - 1 ? 'Next' : 'Done'}
      </button>
    `,
      (root) => {
        on(root, '[data-act="next"]', () => {
          index++;
          if (index >= pulls.length) {
            summary(pulls, done);
          } else {
            sfx.reveal(pulls[index].sticker.rarity);
            haptics.hit();
            render();
          }
        });
      },
      true,
    );
    if (pull.completedSet) sfx.setComplete();
  };

  sfx.reveal(pulls[0].sticker.rarity);
  render();
}

function summary(pulls: PullResult[], done: () => void): void {
  const dust = pulls.reduce((a, p) => a + p.dust, 0);
  const fresh = pulls.filter((p) => !p.duplicate).length;
  mount(
    `
    <h2 class="screen-title">Pack opened</h2>
    <p class="sub">${fresh} new · ${pulls.length - fresh} duplicate${dust ? ` · +${dust} dust` : ''}</p>
    <div class="set-card"><div class="sticker-grid">
      ${pulls.map((p) => stickerTile(p.sticker)).join('')}
    </div></div>
    <button class="btn primary" data-act="done">Continue</button>
    <button class="btn ghost" data-act="album">Open album</button>
  `,
    (root) => {
      on(root, '[data-act="done"]', () => {
        sfx.uiTap();
        done();
      });
      on(root, '[data-act="album"]', () => {
        sfx.uiTap();
        albumScreen();
      });
    },
    true,
  );
}

// ------------------------------------------------------------------ gift --
export function giftScreen(preselect?: string): void {
  const spares = giftableStickers();
  mount(
    `
    <h2 class="screen-title">Gift &amp; Redeem</h2>
    <p class="sub">Send a spare sticker to a friend as a code. Each code works once.</p>

    <div class="set-card">
      <div class="set-head"><h3>Redeem a code</h3></div>
      <input class="field" id="code-in" placeholder="PB-XXXX-XXX" maxlength="12"
             autocomplete="off" autocapitalize="characters" spellcheck="false" />
      <button class="btn primary" data-act="redeem">Redeem</button>
    </div>

    <div class="set-card">
      <div class="set-head"><h3>Your spares</h3><span class="count">${spares.length}</span></div>
      ${
        spares.length
          ? spares
              .map(
                ({ sticker, spare }) => `<div class="row">
                  <span style="font-size:24px">${sticker.glyph}</span>
                  <div class="grow"><b>${esc(sticker.name)}</b>
                    <small>${'★'.repeat(sticker.rarity)} · ${spare} spare</small></div>
                  <button data-mint="${esc(sticker.id)}">Gift</button>
                </div>`,
              )
              .join('')
          : '<p class="sub" style="margin:0">No duplicates yet. Open packs to find some.</p>'
      }
    </div>
    <button class="btn ghost" data-act="back">← Back</button>
  `,
    (root) => {
      on(root, '[data-act="back"]', () => {
        sfx.uiTap();
        homeScreen();
      });
      on(root, '[data-mint]', (el) => {
        const id = el.dataset.mint!;
        const code = mintGift(id);
        if (code) {
          sfx.packOpen();
          haptics.reward();
          giftCodeScreen(STICKERS_BY_ID.get(id)!, code);
        }
      });
      on(root, '[data-act="redeem"]', () => {
        const input = root.querySelector<HTMLInputElement>('#code-in');
        const result = redeemGift(input?.value ?? '');
        if (!result.ok) {
          haptics.tap();
          toast(
            result.reason === 'already-redeemed'
              ? 'That code has already been used'
              : "That code doesn't look right",
          );
          return;
        }
        sfx.setComplete();
        haptics.reward();
        toast(
          result.duplicate
            ? `${result.sticker.name} (duplicate) — +${result.dust} dust`
            : `✦ ${result.sticker.name} added to your album!`,
          3000,
        );
        giftScreen();
      });

      if (preselect) {
        const btn = root.querySelector<HTMLElement>(`[data-mint="${CSS.escape(preselect)}"]`);
        btn?.scrollIntoView({ block: 'center' });
      }
    },
    true,
  );
}

function giftCodeScreen(st: Sticker, code: string): void {
  const text = `I'm sending you ${st.name} ${st.glyph} in Prism Break — redeem it with code ${code}`;
  mount(
    `
    <h2 class="screen-title">Gift sent</h2>
    <p class="sub">${st.glyph} ${esc(st.name)} is packed up. Share the code below.</p>
    <div class="code">${esc(code)}</div>
    <button class="btn primary" data-act="share">Share this gift</button>
    <button class="btn ghost" data-act="back">← Back</button>
  `,
    (root) => {
      on(root, '[data-act="share"]', () => void share(text, 'Prism Break gift'));
      on(root, '[data-act="back"]', () => {
        sfx.uiTap();
        giftScreen();
      });
    },
    true,
  );
}

// --------------------------------------------------------------- results --
export interface ResultPayload {
  score: number;
  wave: number;
  shards: number;
  bestChain: number;
  blocksBroken: number;
  newBest: boolean;
  daily: string | null;
  packsWon: string[];
}

export function resultsScreen(r: ResultPayload): void {
  mount(
    `
    <h2 class="screen-title">${r.newBest ? '🏆 New best!' : r.daily ? 'Daily run over' : 'Run over'}</h2>
    <p class="sub">The wall reached the line at wave ${r.wave}.</p>
    <div class="stats">
      <div><span>Score</span><b class="${r.newBest ? 'hi' : ''}">${fmt(r.score)}</b></div>
      <div><span>Wave</span><b>${r.wave}</b></div>
      <div><span>Best chain</span><b>×${r.bestChain}</b></div>
      <div><span>Shards earned</span><b class="hi">${fmt(r.shards)}</b></div>
      <div><span>Blocks broken</span><b>${fmt(r.blocksBroken)}</b></div>
      <div><span>Album</span><b>${albumProgress().owned}/${albumProgress().total}</b></div>
    </div>
    ${r.packsWon
      .map((reason) => `<div class="hint"><b>🎴 Pack earned</b> — ${esc(reason)}</div>`)
      .join('')}
    <button class="btn primary" data-act="again">↻  Play again</button>
    ${profile.unopened.length ? '<button class="btn gold" data-act="open">🎴 Open your packs</button>' : ''}
    <button class="btn" data-act="share">Share your score</button>
    <button class="btn ghost" data-act="home">← Home</button>
  `,
    (root) => {
      on(root, '[data-act="again"]', () => {
        sfx.uiTap();
        nav.restart();
      });
      on(root, '[data-act="open"]', () => {
        sfx.uiTap();
        shopScreen();
      });
      on(root, '[data-act="home"]', () => {
        sfx.uiTap();
        nav.home();
      });
      on(root, '[data-act="share"]', () => {
        const label = r.daily ? `Daily Challenge ${r.daily}` : 'Prism Break';
        void share(
          `${label}: ${fmt(r.score)} points, wave ${r.wave}, best chain ×${r.bestChain}. Beat that.`,
        );
      });
    },
    true,
  );
}

// ----------------------------------------------------------------- pause --
export function pauseScreen(): void {
  mount(
    `
    <h2 class="screen-title">Paused</h2>
    <p class="sub">Score ${fmt(profile.bestScore)} is the one to beat.</p>
    <button class="btn primary" data-act="resume">Resume</button>
    <button class="btn" data-act="restart">Restart run</button>
    <button class="btn" data-act="help">How to play</button>
    <button class="btn ghost" data-act="home">Quit to menu</button>
  `,
    (root) => {
      on(root, '[data-act="resume"]', () => {
        sfx.uiTap();
        nav.resume();
      });
      on(root, '[data-act="restart"]', () => {
        sfx.uiTap();
        nav.restart();
      });
      on(root, '[data-act="help"]', () => helpScreen(() => pauseScreen()));
      on(root, '[data-act="home"]', () => {
        sfx.uiTap();
        nav.home();
      });
    },
  );
}

// ------------------------------------------------------------------ help --
export function helpScreen(back: () => void = homeScreen): void {
  const sw = (i: number) =>
    `<i class="swatch" style="background:${PALETTE.hues[i].core}"></i>`;

  mount(
    `
    <h2 class="screen-title">How to play</h2>
    <p class="sub">Two rules do all the work.</p>

    <div class="hint">
      <b>1 · Same colour shatters and pierces.</b><br />
      Your ball carries a colour. Hit a block of that colour ${sw(0)}${sw(0)} and it
      shatters instantly — whatever its health — and the ball carries straight on,
      faster. Strung together, one ball can rip a whole vein out of the wall.
    </div>
    <div class="hint">
      <b>2 · A different colour repaints you.</b><br />
      Hit a block of another colour ${sw(1)} and you chip it, bounce off, and
      <b>become that colour</b>. That is the whole game: reading the wall, and
      planning what you will turn into next.
    </div>
    <div class="hint">
      <b>Energy.</b> Every bounce burns a ball's energy and it burns out at zero.
      Piercing costs nothing and gives energy back — so good chains keep the volley alive.
    </div>
    <div class="hint">
      <b>Cascades.</b> When the volley ends, the wall collapses upward into the gaps.
      Five or more touching blocks of one colour detonate on their own, which collapses
      it again — chain multipliers stack fast.
    </div>
    <div class="hint">
      <b>The wall.</b> Each turn a new row pushes in from the top. Clearing blocks pulls
      the wall back up and away from you. Let it cross the red line and the run ends.
    </div>
    <div class="hint">
      <b>◈ Prism</b> matches every colour and leaves yours alone.
      <b>✦ Bomb</b> takes its neighbours with it. <b>Grey stone</b> never resonates —
      chip it down the hard way.
    </div>
    <button class="btn primary" data-act="back">Got it</button>
  `,
    (root) => {
      on(root, '[data-act="back"]', () => {
        sfx.uiTap();
        back();
      });
    },
    true,
  );
}

// -------------------------------------------------------------- settings --
export function settingsScreen(): void {
  mount(
    `
    <h2 class="screen-title">Settings</h2>
    <p class="sub">Player ID ${esc(profile.playerId)}</p>
    <button class="btn" data-act="mute">${isMuted() ? '🔇 Sound off' : '🔊 Sound on'}</button>
    <div class="stats">
      <div><span>Runs</span><b>${fmt(profile.runs)}</b></div>
      <div><span>Blocks broken</span><b>${fmt(profile.blocksBroken)}</b></div>
      <div><span>Daily streak</span><b>${profile.dailyStreak}</b></div>
      <div><span>Best chain</span><b>×${profile.bestChain}</b></div>
    </div>
    <button class="btn ghost" data-act="reset">Erase all progress</button>
    <button class="btn ghost" data-act="back">← Back</button>
  `,
    (root) => {
      on(root, '[data-act="mute"]', () => {
        setMuted(!isMuted());
        profile.muted = isMuted();
        saveProfile();
        sfx.uiTap();
        settingsScreen();
      });
      on(root, '[data-act="reset"]', (el) => {
        if (el.dataset.confirm !== '1') {
          el.dataset.confirm = '1';
          el.textContent = 'Tap again to erase everything';
          return;
        }
        resetProfile();
        toast('Progress erased');
        homeScreen();
      });
      on(root, '[data-act="back"]', () => {
        sfx.uiTap();
        homeScreen();
      });
    },
    true,
  );
}

export function closeOverlay(): void {
  unmount();
}
