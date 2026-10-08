// App states of svnz.exe: LogoState (Batovi screen) -> MainScreenState (menu.xml) -> GameState (Fight).
import { attachInput, isPressed, pollInput, resetInput, anyPressed } from './core/input';
import { useBundledAssets, useDevGameFiles, img } from './core/assets';
import { playMusic, preloadSounds, stopMusic, unlockAudio, playSound } from './core/audio';
import { loadData, DB } from './fight/data';
import { Fight, VS_LEVEL, type PlayerSlot } from './fight/fight';
import { PadSampler, keyboard } from './fight/pad';
import { H, W, drawBanner, drawFight, drawHud, drawText, preloadGraphics } from './render';
import { setSoundTap } from './core/audio';
import { NetClient, type RoomView } from './online/net';
import { Mirror, makeSnap, type Snap } from './online/sync';
import { difficultyOf, type Difficulty } from './online/scaling';
import type { FightSettings } from './online/items';

type Screen = 'loading' | 'logo' | 'vicemi' | 'menu' | 'fight' | 'error';
const STEP = 1 / 60;

/** What the page (React) gets told when a VS / co-op match ends. */
export interface MatchEnd {
  reason: 'finished' | 'left' | 'closed';
  online: boolean;
  mode: 'coop' | 'vs';
  /** this player's side won (co-op: the wave 7 boss fell) */
  won: boolean;
  winner: number;
  text: string;
}

/** A running VS / co-op match: local (one keyboard, two players), hosted (this browser simulates) or joined (this browser mirrors). */
interface Match {
  kind: 'local' | 'host' | 'guest';
  mode: 'coop' | 'vs';
  net?: NetClient;
  mirror?: Mirror;
  sampler?: PadSampler;
  off: (() => void)[];
  seq: number;
  tick: number;
  sounds: [string, number][];
  lastM: number;
  sentAt: number;
  ended: boolean;
  /** guest: when the silent-host watchdog last acted */
  watchAt: number;
  escAt: number;
  note: string;
  noteT: number;
}

export class SvnzGame {
  private g: CanvasRenderingContext2D;
  private buf: HTMLCanvasElement;
  private bg: CanvasRenderingContext2D;
  screen: Screen = 'loading';
  private t = 0;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private detach: (() => void) | null = null;
  menu = 'firstMenu';
  sel = 0;
  fight: Fight | null = null;
  help = false;
  debug = false;
  private error = '';
  /** VS / co-op: the menu entries that need a panel ask the page to show it */
  onUi: ((kind: string) => void) | null = null;
  onMatchEnd: ((e: MatchEnd) => void) | null = null;
  /** true while a panel of the page is open over the menu: the menu ignores the keyboard */
  uiOpen = false;
  match: Match | null = null;
  private markReady: () => void = () => undefined;
  private readyPromise = new Promise<void>((res) => { this.markReady = res; });
  /** resolves once the data and the pictures are loaded (the lobby may bring a player back into a match before that) */
  whenReady(): Promise<void> { return this.readyPromise; }

  constructor(private canvas: HTMLCanvasElement) {
    this.buf = document.createElement('canvas');
    this.buf.width = W;
    this.buf.height = H;
    this.bg = this.buf.getContext('2d')!;
    this.bg.imageSmoothingEnabled = false;
    this.g = canvas.getContext('2d')!;
  }

  get currentScreen(): string { return this.screen === 'fight' && !this.help ? 'play' : this.screen; }
  /** 'menu' | 'play' | ... plus whether an online match is running (the page hides the pause / help buttons) */
  get online(): boolean { return !!this.match && this.match.kind !== 'local'; }

  async start(): Promise<void> {
    this.detach = attachInput();
    this.raf = requestAnimationFrame(this.frame);
    try {
      if (!(await useDevGameFiles()) && !(await useBundledAssets())) throw new Error('no game files');
      await loadData();
      await preloadGraphics();
      void preloadSounds();
      this.goto('logo');
      this.markReady();
    } catch (e) {
      this.error = String(e);
      this.screen = 'error';
    }
    const q = new URLSearchParams(location.search);
    if (q.get('debug')) this.debug = true;
    const lv = q.get('level');
    if (lv && DB.levels[lv]) this.startLevel(lv);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.detach?.();
    stopMusic();
  }

  userGesture(): void { unlockAudio(); }

  private goto(s: Screen): void {
    this.screen = s;
    this.t = 0;
    resetInput();
    if (s === 'menu') { stopMusic(); }
  }

  startLevel(key: string): void {
    this.fight = new Fight(key);
    try { this.fight.record = parseInt(localStorage.getItem('svnz-record-' + key) ?? '0', 10) || 0; } catch { /* ignore */ }
    this.help = false;
    this.goto('fight');
  }

  // ------------------------------------------------------------------ VS / co-op matches
  /** Co-op on one keyboard, 2 players: player 1 arrows + Q W E A S D, player 2 I J K L + U O P , N M. */
  startLocalCoop(chars: [string, string], nicks: [string, string] = ['P1', 'P2'], variants: [number, number] = [0, 1]): void {
    const players: PlayerSlot[] = [
      { id: 0, nick: nicks[0], char: chars[0], team: 1, control: 'p1', variant: variants[0] },
      { id: 1, nick: nicks[1], char: chars[1], team: 1, control: 'p2', variant: variants[1] },
    ];
    this.beginMatch({ kind: 'local', mode: 'coop', players, difficulty: difficultyOf(chars), localId: 0 });
  }

  /** The lobby said "start": the host simulates, the guests mirror. */
  startOnline(net: NetClient, room: RoomView, difficulty: Difficulty, you: number): void {
    // VS is a free-for-all: every player is their own team (the server numbers them id + 1)
    const players: PlayerSlot[] = room.players.map((p) => ({ id: p.id, nick: p.name, char: p.char, team: room.mode === 'vs' ? p.team : 1, control: p.id === you ? 'p1' : 'remote', variant: p.variant }));
    this.beginMatch({ kind: net.isHost ? 'host' : 'guest', mode: room.mode, players, difficulty, localId: you, net, settings: room.settings });
  }

  private beginMatch(o: { kind: Match['kind']; mode: 'coop' | 'vs'; players: PlayerSlot[]; difficulty: Difficulty; localId: number; net?: NetClient; settings?: FightSettings }): void {
    this.endMatchCleanup();
    const m: Match = { kind: o.kind, mode: o.mode, net: o.net, off: [], seq: 0, tick: 0, sounds: [], lastM: -1, sentAt: 0, ended: false, watchAt: -99, escAt: -9, note: '', noteT: 0 };
    this.match = m;
    const key = o.mode === 'vs' ? VS_LEVEL : 'normalLevel';
    if (o.kind === 'guest') {
      m.mirror = new Mirror(key, o.mode, o.localId);
      m.sampler = new PadSampler(keyboard('p1'));
      this.fight = m.mirror.fight;
      const net = o.net!;
      m.off.push(net.on((msg) => {
        if (msg.t === 'snap') {
          try { m.mirror?.apply(msg.d as Snap); } catch (e) { if (m.mirror) m.mirror.failures++; console.error('snapshot', e); }
          if (m.mirror?.mismatch) this.finishMatch('closed', { version: true });
          else if (m.mirror && m.mirror.failures > 90) this.finishMatch('closed', { broken: true });   // about 3 seconds of unreadable snapshots
        }
        else if (msg.t === 'ended') this.finishMatch('finished', msg.d as { won?: boolean; winner?: number; aborted?: boolean } | null);
        else if (msg.t === 'closed') this.finishMatch('closed', null);
        else if (msg.t === 'kicked') this.finishMatch('closed', { kicked: true });
        else if (msg.t === 'link' && msg.state === 'back' && m.mirror) m.mirror.lastAt = performance.now();   // do not count our own outage as a silent host
      }));
    } else {
      this.fight = new Fight(key, { mode: o.mode, players: o.players, difficulty: o.difficulty, localId: o.localId, settings: o.settings });
      try { this.fight.record = parseInt(localStorage.getItem('svnz-record-coop') ?? '0', 10) || 0; } catch { /* ignore */ }
      if (o.kind === 'host') {
        const net = o.net!;
        setSoundTap((k, v) => { if (m.sounds.length < 40) m.sounds.push([k, v]); });
        m.off.push(() => setSoundTap(null));
        m.off.push(net.on((msg) => {
          if (msg.t === 'in') this.fight?.players.find((p) => p.slot === msg.from)?.remote?.set(msg.d as { m: number; tp: number });
          else if (msg.t === 'left') this.fight?.removePlayer(msg.id);
          else if (msg.t === 'peer' && !msg.online) this.fight?.players.find((p) => p.slot === msg.id)?.remote?.release();   // a guest lost the connection: stand still
          else if (msg.t === 'ended') this.finishMatch('finished', msg.d as { aborted?: boolean } | null);   // the server ended the match (we were lost for too long)
          else if (msg.t === 'closed') this.finishMatch('closed', null);
        }));
      }
    }
    this.help = false;
    this.goto('fight');
  }

  private endMatchCleanup(): void {
    const m = this.match;
    if (!m) return;
    m.off.forEach((f) => f());
    m.mirror?.dispose();
    this.match = null;
  }

  /** The match is over (finished, left, or the room closed): tell the page, which shows the results / goes back to the lobby. */
  private finishMatch(reason: MatchEnd['reason'], data: { won?: boolean; winner?: number; aborted?: boolean; kicked?: boolean; version?: boolean; broken?: boolean } | null): void {
    const m = this.match;
    if (!m || m.ended) return;
    m.ended = true;
    const f = this.fight;
    const won = data?.won ?? f?.won ?? false;
    const winner = data?.winner ?? f?.result?.winner ?? 0;
    const winnerName = f?.players.find((p) => p.team === winner)?.nick ?? '';
    const text = reason === 'closed' ? (data?.version ? 'Tu version del juego no es la del anfitrion: recarga la pagina (Ctrl+F5) y vuelve a entrar.' : data?.broken ? 'Error de sincronizacion con el anfitrion: recarga la pagina (Ctrl+F5).' : data?.kicked ? 'El anfitrion te saco de la sala.' : m.kind === 'guest' && !data ? 'Se perdio la conexion con el anfitrion (debe mantener esta pestana visible).' : 'La sala se cerro.') : data?.aborted ? 'El anfitrion termino la partida.' : reason === 'left' ? '' : m.mode === 'vs' ? (winner ? `Gano ${winnerName || 'un jugador'}` : 'Empate') : won ? 'Completaron el juego!' : 'Fin de la partida';
    const online = m.kind !== 'local';
    if (m.kind === 'guest' && reason !== 'finished') m.net?.close();   // lost the host / the room: nothing left to wait for
    this.endMatchCleanup();
    this.fight = null;
    stopMusic();
    this.goto('menu');
    this.menu = 'vsOnline';
    this.sel = 0;
    this.onMatchEnd?.({ reason, online, mode: m.mode, won, winner, text });
  }

  backAction(): void {
    if (this.screen === 'fight') {
      if (this.help) this.help = false;
      else this.escape();
    } else if (this.screen === 'menu' && this.menu !== 'firstMenu') {
      this.menu = 'firstMenu';
      this.sel = 0;
    }
  }
  backLabel(): string { return this.screen === 'fight' && this.help ? '✕' : '↩'; }

  private leaveFight(): void {
    const f = this.fight;
    if (this.match) {
      const m = this.match;
      const done = !!f?.finished;
      if (m.kind === 'host' && !m.ended) m.net?.send({ t: 'end', d: { won: f?.won ?? false, winner: f?.result?.winner ?? 0, aborted: !done } });
      this.finishMatch(m.kind === 'local' || done ? 'finished' : 'left', null);
      if (m.kind === 'guest') m.net?.close();   // a guest who leaves a match leaves the room
      return;
    }
    if (f) {
      try {
        if (f.mode === 'story' && f.count > f.record) localStorage.setItem('svnz-record-' + f.levelKey, String(f.count));
      } catch { /* ignore */ }
    }
    this.fight = null;
    stopMusic();
    this.goto('menu');
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.last) this.last = now;
    this.acc += Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      pollInput();
      this.update(STEP);
    }
    this.render();
  };

  /** Advance the game by `n` fixed steps (tests / dev handle). */
  step(n: number): void {
    for (let i = 0; i < n; i++) { pollInput(); this.update(STEP); }
    this.render();
  }

  private update(dt: number): void {
    this.t += dt;
    switch (this.screen) {
      case 'logo':    // Batovi screen, then the port's own vicemi.dev screen (same timing), then the menu
        if (this.t > 3 || (this.t > 0.5 && anyPressed())) this.goto('vicemi');
        break;
      case 'vicemi':
        if (this.t > 3 || (this.t > 0.5 && anyPressed())) this.goto('menu');
        break;
      case 'menu': this.menuUpdate(); break;
      case 'fight': this.fightUpdate(dt); break;
    }
  }

  private menuUpdate(): void {
    const m = DB.menus[this.menu];
    if (!m || this.uiOpen) return;
    const n = m.options.length;
    if (isPressed('down')) { this.sel = (this.sel + 1) % n; playSound('step'); }
    if (isPressed('up')) { this.sel = (this.sel + n - 1) % n; playSound('step'); }
    if (isPressed('esc') && m.cancel) { this.menu = 'firstMenu'; this.sel = 0; }
    if (isPressed('enter') || isPressed('b1') || isPressed('b0')) this.activate();
  }

  /** Run the selected menu entry (keyboard confirm, mouse click or tap). */
  private activate(): void {
    const m = DB.menus[this.menu];
    const o = m?.options[this.sel];
    if (!o) return;
    playSound('action');
    if (o.link) { this.menu = o.link; this.sel = 0; }
    else if (o.action === 'quitGame') { /* the web build has nowhere to quit to */ }
    else if (o.action?.startsWith('ui:')) this.onUi?.(o.action.slice(3));
    else if (o.action && DB.levels[o.action]) this.startLevel(o.action);
  }

  // Menu layout: compact, below the title picture (the original list overlapped the title letters); 7 entries fit.
  private static readonly MENU_TOP = 104;   // below the title and the "Vicemi Mod" line of mainScreen.png
  private static readonly MENU_X = 112;
  /** 23 px per entry up to 7 entries (the original look); 8 or more get squeezed to fit under the title */
  private static step(n: number): number { return n <= 7 ? 23 : Math.max(16, Math.floor((H - 6 - SvnzGame.MENU_TOP) / n)); }

  /** Mouse / touch on the canvas: hover moves the selection, a click or tap activates the entry under the pointer.
   *  (A convenience of the web port: the original menu only takes the keyboard.) */
  pointer(clientX: number, clientY: number, down: boolean): void {
    if (this.screen !== 'menu') return;
    const r = this.canvas.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H);
    const lx = (clientX - r.left - (r.width - W * s) / 2) / s;
    const ly = (clientY - r.top - (r.height - H * s) / 2) / s;
    const m = DB.menus[this.menu];
    if (!m) return;
    const step = SvnzGame.step(m.options.length);
    const i = Math.floor((ly - SvnzGame.MENU_TOP) / step);
    const inside = !this.uiOpen && i >= 0 && i < m.options.length && lx >= SvnzGame.MENU_X && lx < SvnzGame.MENU_X + 256 &&
      ly - SvnzGame.MENU_TOP - i * step < step - 1;
    this.canvas.style.cursor = inside ? 'pointer' : 'default';
    if (!inside) return;
    if (this.sel !== i) { this.sel = i; if (!down) playSound('step'); }
    if (down) this.activate();
  }

  /** Esc: leave the fight. In an online match it asks twice (the host leaving closes the room for everybody). */
  private escape(): void {
    const m = this.match;
    if (m && m.kind !== 'local' && !m.ended) {
      if (this.t - m.escAt > 2) {
        m.escAt = this.t;
        m.note = m.kind === 'host' ? 'ESC again to end the match' : 'ESC again to leave the room';
        m.noteT = 2;
        return;
      }
    }
    this.leaveFight();
  }

  private fightUpdate(dt: number): void {
    const f = this.fight!;
    const m = this.match;
    if (isPressed('esc')) { this.escape(); return; }
    const online = !!m && m.kind !== 'local';
    if (!online && isPressed('enter')) this.help = !this.help;
    if (this.help && !online) return;
    if (m) m.noteT = Math.max(0, m.noteT - dt);
    if (m?.kind === 'guest') {
      // guest: send the controller, show what the host says
      m.sampler!.sample();
      const mask = m.sampler!.mask();
      if (mask !== m.lastM || m.sampler!.hasTap() || this.t - m.sentAt > 0.1) {
        m.lastM = mask;
        m.sentAt = this.t;
        m.net!.send({ t: 'in', d: m.sampler!.take() });
      }
      m.mirror!.step(dt);
      // snapshots stopped while the socket looks fine: it may be half dead, so get a new one (the seat is kept by the session)
      if (m.mirror!.lastSeq >= 0 && m.mirror!.silence > 3 && !m.net!.reconnecting && this.t - m.watchAt > 8) { m.watchAt = this.t; m.net!.forceReconnect(); }
      if (m.mirror!.silence > 12 && m.mirror!.lastSeq >= 0 && !m.net!.reconnecting) this.finishMatch('closed', null);
      return;
    }
    f.update(dt);
    if (m?.kind === 'host' && !m.ended) {
      if (++m.tick % 2 === 0) m.net!.send({ t: 'snap', d: makeSnap(f, m.seq++, m.sounds) });
      else if (m.sounds.length > 30) m.sounds.length = 30;
    }
    if (f.finished) this.leaveFight();
  }

  // ---------------------------------------------------------------- render
  private render(): void {
    const g = this.bg;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    switch (this.screen) {
      case 'loading':
        drawText(g, 'small', 'Loading...', W / 2, H / 2, 'center');
        break;
      case 'error':
        g.fillStyle = '#fff';
        g.font = '10px monospace';
        g.fillText('Error: ' + this.error, 10, 20);
        break;
      case 'logo': case 'vicemi': {
        const im = img(this.screen === 'logo' ? 'assets/images/misc/batoviScreen.png' : 'assets/images/misc/vicemiScreen.png');
        if (im) {
          g.globalAlpha = Math.min(1, this.t / 0.5, Math.max(0, (3 - this.t) / 0.5));
          g.drawImage(im, 0, 0);
          g.globalAlpha = 1;
        }
        break;
      }
      case 'menu': this.renderMenu(g); break;
      case 'fight': {
        const f = this.fight!;
        drawFight(g, f, this.debug);
        drawHud(g, f);
        if (f.bannerT > 0) drawBanner(g, f.banner);
        if (this.match && this.match.noteT > 0) drawText(g, 'smallOn', this.match.note, W / 2, 124, 'center');
        if (this.match?.net?.reconnecting) drawText(g, 'smallOn', 'Reconnecting...', W / 2, 108, 'center');
        if (this.match?.kind === 'guest' && this.match.mirror && this.match.mirror.lastSeq < 0) drawText(g, 'small', 'Waiting for the host...', W / 2, 120, 'center');
        if (this.help) {
          const h = img('assets/lang/images/help/help.png');
          if (h) g.drawImage(h, 0, 0);
        }
        break;
      }
    }
    this.present();
  }

  private renderMenu(g: CanvasRenderingContext2D): void {
    const bg = img('assets/images/misc/mainScreen.png');
    if (bg) g.drawImage(bg, 0, 0);
    const sel = img('assets/images/hud/menu/selector.png');
    const m = DB.menus[this.menu];
    if (!m) return;
    const step = SvnzGame.step(m.options.length);
    m.options.forEach((o, i) => {
      const y = SvnzGame.MENU_TOP + i * step;
      if (sel) {
        g.globalAlpha = i === this.sel ? 1 : 0.6;
        g.drawImage(sel, 0, i === this.sel ? 0 : 24, 256, 24, SvnzGame.MENU_X, y, 256, step - 1);
        g.globalAlpha = 1;
      }
      drawText(g, i === this.sel ? 'smallOn' : 'smallOff', o.textKey, W / 2, y + Math.round((step - 1 - 8) / 2) + 1, 'center');
    });
  }

  private present(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(c.clientWidth * dpr), ch = Math.round(c.clientHeight * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#000';
    g.fillRect(0, 0, cw, ch);
    const s = Math.min(cw / W, ch / H);
    const w = Math.round(W * s), h = Math.round(H * s);
    g.drawImage(this.buf, Math.round((cw - w) / 2), Math.round((ch - h) / 2), w, h);
  }
}

export { playMusic };
