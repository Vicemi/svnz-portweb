// App states of svnz.exe: LogoState (Batovi screen) -> MainScreenState (menu.xml) -> GameState (Fight).
import { attachInput, isPressed, pollInput, resetInput, anyPressed } from './core/input';
import { useBundledAssets, useDevGameFiles, img } from './core/assets';
import { playMusic, preloadSounds, stopMusic, unlockAudio, playSound } from './core/audio';
import { loadData, DB } from './fight/data';
import { Fight } from './fight/fight';
import { H, W, drawBanner, drawFight, drawHud, drawText, preloadGraphics } from './render';

type Screen = 'loading' | 'logo' | 'vicemi' | 'menu' | 'fight' | 'error';
const STEP = 1 / 60;

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

  constructor(private canvas: HTMLCanvasElement) {
    this.buf = document.createElement('canvas');
    this.buf.width = W;
    this.buf.height = H;
    this.bg = this.buf.getContext('2d')!;
    this.bg.imageSmoothingEnabled = false;
    this.g = canvas.getContext('2d')!;
  }

  get currentScreen(): string { return this.screen === 'fight' && !this.help ? 'play' : this.screen; }

  async start(): Promise<void> {
    this.detach = attachInput();
    this.raf = requestAnimationFrame(this.frame);
    try {
      if (!(await useDevGameFiles()) && !(await useBundledAssets())) throw new Error('no game files');
      await loadData();
      await preloadGraphics();
      void preloadSounds();
      this.goto('logo');
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

  backAction(): void {
    if (this.screen === 'fight') {
      if (this.help) this.help = false;
      else this.leaveFight();
    } else if (this.screen === 'menu' && this.menu !== 'firstMenu') {
      this.menu = 'firstMenu';
      this.sel = 0;
    }
  }
  backLabel(): string { return this.screen === 'fight' && this.help ? '✕' : '↩'; }

  private leaveFight(): void {
    const f = this.fight;
    if (f) {
      try {
        if (f.count > f.record) localStorage.setItem('svnz-record-' + f.levelKey, String(f.count));
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
    if (!m) return;
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
    else if (o.action && DB.levels[o.action]) this.startLevel(o.action);
  }

  // Menu layout: compact, below the title picture (the original list overlapped the title letters); 7 entries fit.
  private static readonly MENU_TOP = 104;   // below the title and the "Vicemi Mod" line of mainScreen.png
  private static readonly MENU_STEP = 23;
  private static readonly MENU_X = 112;

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
    const i = Math.floor((ly - SvnzGame.MENU_TOP) / SvnzGame.MENU_STEP);
    const inside = i >= 0 && i < m.options.length && lx >= SvnzGame.MENU_X && lx < SvnzGame.MENU_X + 256 &&
      ly - SvnzGame.MENU_TOP - i * SvnzGame.MENU_STEP < 22;
    this.canvas.style.cursor = inside ? 'pointer' : 'default';
    if (!inside) return;
    if (this.sel !== i) { this.sel = i; if (!down) playSound('step'); }
    if (down) this.activate();
  }

  private fightUpdate(dt: number): void {
    const f = this.fight!;
    if (isPressed('esc')) { this.leaveFight(); return; }
    if (isPressed('enter')) this.help = !this.help;
    if (this.help) return;
    f.update(dt);
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
    m.options.forEach((o, i) => {
      const y = SvnzGame.MENU_TOP + i * SvnzGame.MENU_STEP;
      if (sel) {
        g.globalAlpha = i === this.sel ? 1 : 0.6;
        g.drawImage(sel, 0, i === this.sel ? 0 : 24, 256, 24, SvnzGame.MENU_X, y, 256, 22);
        g.globalAlpha = 1;
      }
      drawText(g, i === this.sel ? 'smallOn' : 'smallOff', o.textKey, W / 2, y + 7, 'center');
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
