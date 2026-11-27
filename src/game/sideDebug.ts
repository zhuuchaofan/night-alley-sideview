import { isBgmStarted } from './bgm.ts';
import { getSoundState } from './sound.ts';
import type { RoomType } from './rooms.ts';

export interface DoorDebugInfo {
  choice: number;
  label: string;
}

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
  /** S2 stage state (SideGameScene; other scenes report defaults). */
  seed: number;
  roomIndex: number;
  roomType: RoomType | '';
  roomCount: number;
  roomTemplateId: string;
  stageCleared: boolean;
  /** 链签名: 槽位类型 + 候选模板 id + chosen, 供 E2E 跨局比较。 */
  chainSignature: string;
  /** 当前房间已出的门 (空 = 未出门)。 */
  doors: DoorDebugInfo[];
  /** 选门是否已提交 (doorUsed 锁定) 与挂起的换房目标 (POST_UPDATE 执行)。 */
  doorUsed: boolean;
  pendingNext: number | null;
  /** submitDoor 被调用的总次数 (含被 doorUsed 挡下的重复提交)。 */
  doorSubmitAttempts: number;
  /** 物理世界当前活跃的 collider/overlap 数 (换房无残留断言用)。 */
  activeColliders: number;
  /** 诊断: 每扇门的 bg 是否有 input 组件及是否启用; 输入插件 _list / _pendingInsertion 长度。 */
  doorInput: { choice: number; hasInput: boolean; enabled: boolean }[];
  inputListSize: number;
  pendingInsertionSize: number;
  /** 诊断: 场景级 pointerdown 事件计数 (processDownEvents 的 POINTER_DOWN 步骤)。 */
  pointerDowns: number;
  /** 玩家身体盒底 y 与是否着地 (走跳/生成点验收用)。 */
  bodyBottom: number;
  grounded: boolean;
  /** 每个敌人的身体盒底 y, 与模板 spawns 顺序一致。 */
  enemyBodyBottoms: number[];
}

export type SceneSideviewDebugState = Omit<SideviewDebugState, 'soundMuted' | 'bgmStarted'>;

export interface SideviewDebugHook {
  getState(): SideviewDebugState;
  spawnEnemyNearPlayer(): void;
  setHp(hp: number): void;
  setSeed(seed: number): void;
  /** 测试专用: 直接进指定模板的房间 (走跳验收用), 不走选门流程。 */
  enterTemplate?(templateId: string): void;
  /** 测试专用: 把玩家传送到指定位置 (走跳验收用)。 */
  teleportPlayer?(x: number, y: number): void;
  /** 测试专用: 对当前活动指针做一次 hitTest, 返回指针游戏坐标与命中对象。 */
  probeHit?(): { px: number; py: number; over: string[]; listSize: number };
}

export interface SceneSideviewDebugHook {
  getState(): SceneSideviewDebugState;
  spawnEnemyNearPlayer(): void;
  setHp(hp: number): void;
  setSeed(seed: number): void;
  enterTemplate?(templateId: string): void;
  teleportPlayer?(x: number, y: number): void;
  probeHit?(): { px: number; py: number; over: string[]; listSize: number };
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

/** 非游戏场景的 S2 调试字段默认值。 */
export const DEFAULT_STAGE_DEBUG_STATE = {
  seed: 0,
  roomIndex: 0,
  roomType: '' as RoomType | '',
  roomCount: 0,
  roomTemplateId: '',
  stageCleared: false,
  chainSignature: '',
  doors: [] as DoorDebugInfo[],
  doorUsed: false,
  pendingNext: null as number | null,
  doorSubmitAttempts: 0,
  activeColliders: 0,
  doorInput: [] as { choice: number; hasInput: boolean; enabled: boolean }[],
  inputListSize: 0,
  pendingInsertionSize: 0,
  pointerDowns: 0,
  bodyBottom: 0,
  grounded: false,
  enemyBodyBottoms: [] as number[],
};
