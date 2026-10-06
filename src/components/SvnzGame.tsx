import { useEffect, useRef, useState } from 'react';
import { SvnzGame } from '../svnz/game';
import TouchControls from './TouchControls';

/** Full-window game canvas (480x272 letterboxed). Touch devices get a rotate prompt, the fight controls and
 *  always-visible back / help buttons. Any click or key is the audio-unlocking user gesture. */
export default function SvnzGameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<SvnzGame | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [screen, setScreen] = useState('');
  const [full, setFull] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const canFull = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  useEffect(() => {
    const g = new SvnzGame(canvasRef.current!);
    gameRef.current = g;
    if (import.meta.env.DEV) (window as unknown as { __svnz: SvnzGame }).__svnz = g;
    void g.start();
    const gesture = () => g.userGesture();
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    return () => {
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
      g.stop();
    };
  }, []);

  useEffect(() => {
    const forced = new URLSearchParams(location.search).get('touch');
    setIsTouch(forced !== null ? forced !== '0' : 'ontouchstart' in window || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches);
    const update = () => setPortrait(window.innerHeight > window.innerWidth);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('orientationchange', update); };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setScreen(gameRef.current?.currentScreen ?? ''), 120);
    return () => window.clearInterval(id);
  }, []);

  // fullscreen (button on touch screens, F4 on keyboards like the original); landscape is requested when supported
  const toggleFull = () => {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      const el = stageRef.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
      void (el?.requestFullscreen?.() ?? el?.webkitRequestFullscreen?.());
      try { void (window.screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation?.lock?.('landscape'); } catch { /* not supported */ }
    }
  };
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    const onKey = (e: KeyboardEvent) => { if (e.code === 'F4') { e.preventDefault(); toggleFull(); } };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('fullscreenchange', onChange); window.removeEventListener('keydown', onKey); };
  }, []);

  const key = (code: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), 60);
  };

  // menus on touch: tap the upper/lower part of the screen to move, the middle to select
  const menuTap = (e: React.PointerEvent) => {
    if (!isTouch || (screen !== 'menu' && screen !== 'logo' && screen !== 'vicemi')) return;
    const y = e.clientY / window.innerHeight;
    key(screen === 'logo' || screen === 'vicemi' ? 'Enter' : y < 0.42 ? 'ArrowUp' : y > 0.78 ? 'ArrowDown' : 'Enter');
  };
  const back = (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); gameRef.current?.backAction(); };

  return (
    <div className="sv-stage" ref={stageRef} onPointerDown={menuTap}>
      <canvas ref={canvasRef} className="sv-canvas" tabIndex={0} />
      {isTouch && portrait && (
        <div className="sv-rotate"><div className="sv-rotate-inner"><span className="sv-rotate-icon">🔄</span><span>Girá el celular para jugar</span></div></div>
      )}
      <TouchControls active={isTouch && !portrait && screen === 'play'} />
      {isTouch && !portrait && canFull && (
        <button className="sv-top-btn sv-full-btn" aria-label="Pantalla completa" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); toggleFull(); }}>{full ? '✕' : '⛶'}</button>
      )}
      {isTouch && !portrait && (screen === 'play' || screen === 'fight') && (
        <button className="sv-top-btn sv-help-btn" aria-label="Ayuda" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); key('Enter'); }}>?</button>
      )}
      {isTouch && !portrait && (screen === 'play' || screen === 'fight' || screen === 'menu') && (
        <button className="sv-top-btn" aria-label="Volver" onPointerDown={back}>↩</button>
      )}
    </div>
  );
}
