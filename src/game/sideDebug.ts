import { isBgmStarted } from './bgm.ts';
import { getSoundState } from './sound.ts';

export interface SideviewDebugState {
  scene: 'TitleScene' | 'SideGameScene' | 'GameOverScene';
  x: number;
  y: number;
  hp: number;
  kills: number;
  coins: number;
  enemiesAlive: number;
  roomCleared: boolean;
  soundMuted: boolean;
  bgmStarted: boolean;
  /** Game-feel counters (SideGameScene only; other scenes report 0). */
  damageNumbersShown: number;
  burstsSpawned: number;
  hitstopsApplied: number;
}

export type SceneSideviewDebugState = Omit<SideviewDebugState, 'soundMuted' | 'bgmStarted'>;

export interface SideviewDebugHook {
  getState(): SideviewDebugState;
  spawnEnemyNearPlayer(): void;
  setHp(hp: number): void;
}

export interface SceneSideviewDebugHook {
  getState(): SceneSideviewDebugState;
  spawnEnemyNearPlayer(): void;
  setHp(hp: number): void;
}

declare global {
  interface Window {
    __SIDEVIEW_DEBUG__?: SideviewDebugHook;
  }
}

export function registerSideDebugHook(hook: SceneSideviewDebugHook): void {
  window.__SIDEVIEW_DEBUG__ = {
    ...hook,
    getState: () => ({
      ...hook.getState(),
      soundMuted: getSoundState().soundMuted,
      bgmStarted: isBgmStarted(),
    }),
  };
}
