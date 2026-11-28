import { isBgmStarted } from './bgm.ts';
import { getSoundState } from './sound.ts';
import type { CurseId, EnemyKind, PlayerForm, ShopItemId } from './balance.ts';
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
  /** 重击触发的相机震屏次数 (SideGameScene only; other scenes report 0). */
  heavyShakesApplied: number;
  /** 场景时钟 ms (与 contactSignals.timeMs 同一时钟, 供掉血配对用)。 */
  timeNow: number;
  /** S2 stage state (SideGameScene; other scenes report defaults). */
  seed: number;
  roomIndex: number;
  roomType: RoomType | '';
  roomCount: number;
  roomTemplateId: string;
  readonly hudRoomText?: string; // 只读：调试快照里暴露 HUD 房数文本，供 E2E 断言；无玩法路径消费它。
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
  /** 玩家是否处于翻滚免伤状态 (rollTimer > 0 或刚结束的宽限帧)。 */
  rolling: boolean;
  /** 玩家物理盒四边 (接触/贴边验收用)。 */
  playerBody?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  /** 每个敌人的身体盒底 y, 与模板 spawns 顺序一致。 */
  enemyBodyBottoms: number[];
  /** 每个敌人的位置、种类、包围盒四边、HP 与表现状态 (接触/分离/多怪验收用)。
   * body* 为取整值 (既有用例断言精确像素); body*Raw 为未取整的实际盒边,
   * 供分离验收用实际半宽之和判定重叠。 */
  enemyInfos?: {
    id: number;
    kind: EnemyKind;
    x: number;
    y: number;
    bodyLeft: number;
    bodyRight: number;
    bodyTop: number;
    bodyBottom: number;
    bodyLeftRaw: number;
    bodyRightRaw: number;
    bodyTopRaw: number;
    bodyBottomRaw: number;
    hp: number;
    hitFlash?: boolean;
    attackFlash?: boolean;
    windup?: boolean;
    knockX?: number;
  }[];
  /** 最近接触攻击信号 (攻击者 id 与场景时间 ms, 供可读性验收对应掉血)。 */
  contactSignals?: { enemyId: number; timeMs: number }[];
  /** 场上敌方射弹数。 */
  enemyBoltsAlive?: number;
  /** 场上未拾取的铜钱数。 */
  coinDropsAlive?: number;
  /** S2 (c) 双形态、霉运、商店、灯油/心魔核调试字段。 */
  form?: PlayerForm;
  maxHp?: number;
  /** 玩家水平速度（切换取消疾攻验收用：中途按 Q 后应立即归零）。 */
  velocityX?: number;
  switchCooldown?: number;
  talismanCooldown?: number;
  talismanProjectilesAlive?: number;
  curse?: CurseId | null;
  curseMenuOpen?: boolean;
  shopMenuOpen?: boolean;
  shopPurchased?: ShopItemId[];
  lampOil?: number;
  demonCore?: number;
  oilDropsAlive?: number;
  coreDropsAlive?: number;
  paused?: boolean;
  swordDamage?: number;
  talismanDamage?: number;
  readonly hudFormText?: string;
  readonly hudCurseText?: string;
  readonly hudPickupsText?: string;
}

export type SceneSideviewDebugState = Omit<SideviewDebugState, 'soundMuted' | 'bgmStarted'>;

export interface SideviewDebugHook {
  getState(): SideviewDebugState;
  spawnEnemyNearPlayer(kind?: EnemyKind): void;
  setHp(hp: number): void;
  setCoins?(coins: number): void;
  setSeed(seed: number): void;
  /** 测试专用: 直接进指定模板的房间 (走跳验收用), 不走选门流程。 */
  enterTemplate?(templateId: string): void;
  /** 测试专用: 把玩家传送到指定位置 (走跳验收用)。 */
  teleportPlayer?(x: number, y: number): void;
  /** 测试专用: 清空场上敌人 (接触距离回归测试用)。 */
  clearEnemies?(): void;
  /** 测试专用: 在指定位置生成/定住测试敌人 (接触距离回归测试用)。 */
  placeTestEnemy?(kind: EnemyKind, footX: number, surfaceY: number, frozen?: boolean): void;
  /** 测试专用: 对当前活动指针做一次 hitTest, 返回指针游戏坐标与命中对象。 */
  probeHit?(): { px: number; py: number; over: string[]; listSize: number };
}

export interface SceneSideviewDebugHook {
  getState(): SceneSideviewDebugState;
  spawnEnemyNearPlayer(kind?: EnemyKind): void;
  setHp(hp: number): void;
  setCoins?(coins: number): void;
  setSeed(seed: number): void;
  enterTemplate?(templateId: string): void;
  teleportPlayer?(x: number, y: number): void;
  clearEnemies?(): void;
  placeTestEnemy?(kind: EnemyKind, footX: number, surfaceY: number, frozen?: boolean): void;
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
