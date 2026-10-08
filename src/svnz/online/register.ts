// Adds the VS arena level, the "VS y Online" menu entry and its submenu on top of the original data tables (like bonus/data.ts).
import { DB } from '../fight/data';
import { VS_LEVEL } from './const';

/** Menu actions that open the lobby panel (React) instead of starting a level. */
export const UI_ACTIONS = { localCoop: 'ui:localCoop', onlineCoop: 'ui:onlineCoop', onlineVs: 'ui:onlineVs', join: 'ui:join' } as const;

export function registerOnline(): void {
  DB.levels[VS_LEVEL] = {
    key: VS_LEVEL, name: 'VS', bg: 'arena', music: 'bgmBoss', playerTeam: 'singleTeamMina',
    waves: [{ name: 'vsWave', music: 'bgmBoss', initialTextKey: 'Get Ready To Fight!', startTextKey: 'FIGHT!', finalTextKey: 'GAME!', failTextKey: 'GAME!' }],
  };
  DB.waves.vsWave = { mode: 'VsMode', list: '', activeEnemies: 0, activeExtras: 0, loopIndex: 0, time: 0 };

  const first = DB.menus.firstMenu;
  if (first && !first.options.some((o) => o.link === 'vsOnline')) {
    const exit = first.options.findIndex((o) => o.action === 'quitGame');
    first.options.splice(exit < 0 ? first.options.length : exit, 0, { textKey: 'VS y Online', link: 'vsOnline' });
  }
  DB.menus.vsOnline = {
    cancel: 'Back',
    options: [
      { textKey: 'Coop Local (2 jug.)', action: UI_ACTIONS.localCoop },
      { textKey: 'Crear sala: Coop', action: UI_ACTIONS.onlineCoop },
      { textKey: 'Crear sala: VS', action: UI_ACTIONS.onlineVs },
      { textKey: 'Unirse con codigo', action: UI_ACTIONS.join },
      { textKey: 'Atras', link: 'firstMenu' },
    ],
  };
}
