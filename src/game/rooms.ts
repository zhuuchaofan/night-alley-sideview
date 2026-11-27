/**
 * S2 切片 (a): 房间拼接 — 槽位模型、7 个手写模板、种子生成器、可达性校验。
 *
 * 设计唯一权威: ~/workspace/night-alley/s2-design/design-rooms.md (v3)。
 * 纯函数模块, 不碰 Phaser, 可单测。
 *
 * 跳跃物理 (balance.ts, 不改): 重力 1400, 跳速 -520, 移速 160,
 * 最大跳高 520^2/(2*1400) ≈ 96.6px。玩家身体盒 28x48 (半宽 14px)。
 */
import { ARENA_WIDTH, SIDE_GROUND_Y, SIDE_WALL_WIDTH } from './balance.ts';

export type RoomType = 'entrance' | 'combat' | 'shop' | 'elite' | 'chest' | 'boss';

/** 平台: x/y 为中心点 (Phaser add.rectangle 的定位方式)。顶面 y = y - h / 2。 */
export interface PlatformDef {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 生成点: 脚底锚点。转换: sprite.x = footX, sprite.y = surfaceY - 22 (身体盒底 = sprite.y + 22)。 */
export interface SpawnDef {
  kind: 'paper';
  footX: number;
  surfaceY: number;
}

export interface RoomTemplate {
  id: string;
  type: RoomType;
  /** 门上显示的奖励, 不标房间地形, 如「宝箱 · 铜钱」。 */
  label: string;
  platforms: PlatformDef[];
  spawns: SpawnDef[];
  /** 宝箱房固定铜钱 (切片 (a) 只记数据, 不生成拾取; 见设计 §1)。 */
  coins?: { x: number; y: number; n: number }[];
}

export type StageSlot =
  | { kind: 'fixed'; type: RoomType }
  | { kind: 'choice'; options: [RoomType, RoomType] };

/**
 * chosen: 固定槽初始化为 0; 分支槽初始化为 null (未选), 合法值为 0 | 1。
 * 重开本局 (同种子重试) 时 generateStage 重新生成, 所有分支槽 chosen 恢复为 null。
 */
export interface SlotInstance {
  slot: StageSlot;
  candidates: RoomTemplate[];
  chosen: number | null;
}

export interface StageChain {
  seed: number;
  slots: SlotInstance[];
}

/** 可站面: 顶面 y + 身体中心可站的 x 区间 (平台 x 区间两端各缩 14px 身体半宽)。 */
interface Surface {
  top: number;
  minX: number;
  maxX: number;
  /** 截挡判定用的完整 x 区间 (不缩)。 */
  fullMinX: number;
  fullMaxX: number;
}

/** 地面: 顶面 y=500, 可站区间为墙内缩 14px 后的 [78, 882]。 */
const GROUND_SURFACE: Surface = {
  top: SIDE_GROUND_Y,
  minX: SIDE_WALL_WIDTH + 14,
  maxX: ARENA_WIDTH - SIDE_WALL_WIDTH - 14,
  fullMinX: SIDE_WALL_WIDTH,
  fullMaxX: ARENA_WIDTH - SIDE_WALL_WIDTH,
};

/** 跳跃常量 (与 balance.ts 一致, 校验用)。 */
const JUMP_VELOCITY = 520;
const MOVE_SPEED = 160;
const GRAVITY = 1400;
const MAX_RISE = 88;
const SAFETY = 0.85;
const BODY_HALF_WIDTH = 14;

function platformSurface(p: PlatformDef): Surface {
  return {
    top: p.y - p.h / 2,
    minX: p.x - p.w / 2 + BODY_HALF_WIDTH,
    maxX: p.x + p.w / 2 - BODY_HALF_WIDTH,
    fullMinX: p.x - p.w / 2,
    fullMaxX: p.x + p.w / 2,
  };
}

function roomSurfaces(t: RoomTemplate): Surface[] {
  return [GROUND_SURFACE, ...t.platforms.map(platformSurface)];
}

/** 两个可站区间的水平间隔 (重叠时为 0)。 */
function intervalGap(a: Surface, b: Surface): number {
  return Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
}

/**
 * 边 A→B 是否可一跳到达 (§2 保守边公式)。
 * rise = A 顶面 - B 顶面 (B 比 A 高为正)。
 * 上跳: rise > 88 直接无边; 下落分支时间 t2 = (520 + sqrt(520² - 2800·rise)) / 1400,
 * 水平允许距离 = 0.85 × 160 × t2。
 * 下落: 允许距离 = 0.85 × 160 × sqrt(2·drop/1400)。
 * 截挡: 扫掠范围 = A、B 可站区间的并集 x 区间; 若有另一平台的 x 区间与之重叠、
 * 且其顶面严格介于 A、B 顶面之间, 则该边无效 (下降段会被它先接住)。
 */
export function canJumpBetween(a: Surface, b: Surface, all: Surface[]): boolean {
  const rise = a.top - b.top;
  if (rise > MAX_RISE) {
    return false;
  }
  let allowed: number;
  if (rise >= 0) {
    allowed = SAFETY * MOVE_SPEED * ((JUMP_VELOCITY + Math.sqrt(JUMP_VELOCITY ** 2 - 2 * GRAVITY * rise)) / GRAVITY);
  } else {
    const drop = -rise;
    allowed = SAFETY * MOVE_SPEED * Math.sqrt((2 * drop) / GRAVITY);
  }
  if (intervalGap(a, b) > allowed) {
    return false;
  }
  const lo = Math.min(a.top, b.top);
  const hi = Math.max(a.top, b.top);
  const sweepMin = Math.min(a.minX, b.minX);
  const sweepMax = Math.max(a.maxX, b.maxX);
  for (const s of all) {
    if (s === a || s === b) {
      continue;
    }
    if (s.top > lo && s.top < hi && s.fullMinX < sweepMax && s.fullMaxX > sweepMin) {
      return false;
    }
  }
  return true;
}

/**
 * 从地面 BFS, 全平台可达才算通过。平台可站区间为空 (太窄) 也判否。
 * 数值举例: rise=88 时允许水平 ≈65px; rise=40 时 ≈89px; 同高时 ≈101px。
 */
export function isRoomReachable(t: RoomTemplate): boolean {
  const surfaces = roomSurfaces(t);
  for (let i = 1; i < surfaces.length; i += 1) {
    if (surfaces[i].minX >= surfaces[i].maxX) {
      return false;
    }
  }
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const cur = queue.shift() as number;
    for (let i = 1; i < surfaces.length; i += 1) {
      if (visited.has(i)) {
        continue;
      }
      if (canJumpBetween(surfaces[cur], surfaces[i], surfaces)) {
        visited.add(i);
        queue.push(i);
      }
    }
  }
  return visited.size === surfaces.length;
}

/**
 * BFS 跳跃计划: 每个平台的起跳面 (null = 地面), 按平台序号返回。
 * E2E Arcade 走跳验收用: 按此计划逐个平台实机跳一遍。
 */
export interface JumpStep {
  platformIndex: number;
  /** 起跳平台序号; null 表示从地面起跳。 */
  fromIndex: number | null;
}

export function jumpPlan(t: RoomTemplate): JumpStep[] {
  const surfaces = roomSurfaces(t);
  const parent = new Map<number, number>();
  parent.set(0, -1);
  const queue = [0];
  while (queue.length > 0) {
    const cur = queue.shift() as number;
    for (let i = 1; i < surfaces.length; i += 1) {
      if (parent.has(i)) {
        continue;
      }
      if (canJumpBetween(surfaces[cur], surfaces[i], surfaces)) {
        parent.set(i, cur);
        queue.push(i);
      }
    }
  }
  const steps: JumpStep[] = [];
  for (let i = 1; i < surfaces.length; i += 1) {
    const from = parent.get(i);
    if (from === undefined) {
      continue;
    }
    steps.push({ platformIndex: i - 1, fromIndex: from === 0 ? null : from - 1 });
  }
  return steps;
}

/** 生成点校验: footX 落在某支撑面可站区间内, surfaceY 等于该面顶面 (误差 ≤2px)。 */
export function isSpawnValid(spawn: SpawnDef, t: RoomTemplate): boolean {
  const surfaces = roomSurfaces(t);
  return surfaces.some(
    (s) =>
      spawn.footX >= s.minX &&
      spawn.footX <= s.maxX &&
      Math.abs(spawn.surfaceY - s.top) <= 2,
  );
}

/** 模板的全部生成点都通过校验。 */
export function isRoomSpawnsValid(t: RoomTemplate): boolean {
  return t.spawns.every((s) => isSpawnValid(s, t));
}

// ---------------------------------------------------------------------------
// 7 个手写模板 (切片 (a); Boss 模板由 (b) 补第 8 个)。
// 每个类型池的第 1 个模板是该类型的保底模板 (手写、可达性校验通过)。
// 平台布局均按 §2 边公式手算过, 单测 + Arcade 走跳验收双保险。
// ---------------------------------------------------------------------------

export const ROOM_TEMPLATES: RoomTemplate[] = [
  {
    id: 'entrance-1',
    type: 'entrance',
    label: '入口 · 夜巷',
    platforms: [
      { x: 280, y: 440, w: 220, h: 16 },
      { x: 520, y: 372, w: 220, h: 16 },
    ],
    spawns: [
      { kind: 'paper', footX: 480, surfaceY: 500 },
      { kind: 'paper', footX: 580, surfaceY: 500 },
      { kind: 'paper', footX: 700, surfaceY: 500 },
    ],
  },
  {
    id: 'combat-1',
    type: 'combat',
    label: '战斗 · 掉落',
    platforms: [
      { x: 250, y: 452, w: 200, h: 16 },
      { x: 480, y: 396, w: 200, h: 16 },
      { x: 720, y: 340, w: 180, h: 16 },
    ],
    spawns: [
      { kind: 'paper', footX: 500, surfaceY: 500 },
      { kind: 'paper', footX: 620, surfaceY: 500 },
      { kind: 'paper', footX: 760, surfaceY: 500 },
      { kind: 'paper', footX: 480, surfaceY: 388 },
    ],
  },
  {
    id: 'combat-2',
    type: 'combat',
    label: '战斗 · 心魔',
    platforms: [
      { x: 300, y: 436, w: 260, h: 16 },
      { x: 600, y: 436, w: 260, h: 16 },
      { x: 480, y: 352, w: 200, h: 16 },
    ],
    spawns: [
      { kind: 'paper', footX: 420, surfaceY: 500 },
      { kind: 'paper', footX: 700, surfaceY: 500 },
      { kind: 'paper', footX: 300, surfaceY: 428 },
      { kind: 'paper', footX: 480, surfaceY: 344 },
    ],
  },
  {
    id: 'combat-3',
    type: 'combat',
    label: '战斗 · 夜巡',
    platforms: [
      // P1 左缘须避开玩家入口 x=100: 旧布局 [100,340] 会让 P2 刷的怪掉到 P1 上、
      // 走到玩家头顶 (盒底 452) 停住——地面挥剑 hitbox 顶为 453, 差 1px 永远打不到,
      // 房间站桩清不掉。右移至 [160,400] 后怪在 x<146 处掉下 P1、落回地面。
      { x: 280, y: 460, w: 240, h: 16 },
      { x: 480, y: 400, w: 220, h: 16 },
      { x: 720, y: 344, w: 200, h: 16 },
    ],
    spawns: [
      { kind: 'paper', footX: 400, surfaceY: 500 },
      { kind: 'paper', footX: 620, surfaceY: 500 },
      { kind: 'paper', footX: 800, surfaceY: 500 },
      { kind: 'paper', footX: 480, surfaceY: 392 },
    ],
  },
  {
    id: 'chest-1',
    type: 'chest',
    label: '宝箱 · 铜钱',
    platforms: [
      { x: 300, y: 444, w: 240, h: 16 },
      { x: 560, y: 380, w: 240, h: 16 },
    ],
    spawns: [],
    coins: [{ x: 480, y: 470, n: 5 }],
  },
  {
    id: 'shop-1',
    type: 'shop',
    label: '商店 · 买药',
    platforms: [
      { x: 320, y: 448, w: 220, h: 16 },
      { x: 580, y: 384, w: 220, h: 16 },
    ],
    spawns: [],
  },
  {
    id: 'elite-1',
    type: 'elite',
    label: '精英 · 强敌',
    platforms: [
      { x: 260, y: 448, w: 220, h: 16 },
      { x: 500, y: 384, w: 220, h: 16 },
      { x: 740, y: 324, w: 200, h: 16 },
    ],
    spawns: [
      { kind: 'paper', footX: 420, surfaceY: 500 },
      { kind: 'paper', footX: 600, surfaceY: 500 },
      { kind: 'paper', footX: 780, surfaceY: 500 },
      { kind: 'paper', footX: 260, surfaceY: 440 },
      { kind: 'paper', footX: 500, surfaceY: 376 },
    ],
  },
];

/** 每种房型的模板池; 每池第 1 个是该类型的保底模板 (手写、可达性校验通过)。 */
export const TEMPLATES_BY_TYPE: Record<RoomType, RoomTemplate[]> = {
  entrance: ROOM_TEMPLATES.filter((t) => t.type === 'entrance'),
  combat: ROOM_TEMPLATES.filter((t) => t.type === 'combat'),
  shop: ROOM_TEMPLATES.filter((t) => t.type === 'shop'),
  elite: ROOM_TEMPLATES.filter((t) => t.type === 'elite'),
  chest: ROOM_TEMPLATES.filter((t) => t.type === 'chest'),
  boss: ROOM_TEMPLATES.filter((t) => t.type === 'boss'),
};

export function getTemplateById(id: string): RoomTemplate | undefined {
  return ROOM_TEMPLATES.find((t) => t.id === id);
}

/** 槽位当前选定的模板 (分支槽未选时取候选第 1 个, 仅作预览; 场景只在提交后进房)。 */
export function resolveTemplate(slot: SlotInstance): RoomTemplate {
  return slot.candidates[slot.chosen ?? 0];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 从池里抽一个可达模板; 抽 10 次仍未通过可达性校验时用池里第一个可达的
 * 模板作保底 (通常就是池首项, 即约定的保底模板); 池里一个可达的都没有,
 * 说明手写模板被改坏了, 直接报错而不是把坏房间送进关卡。
 */
export function pickTemplate(pool: RoomTemplate[], rng: () => number): RoomTemplate {
  if (pool.length === 0) {
    throw new Error('pickTemplate: empty pool');
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = pool[Math.floor(rng() * pool.length)];
    if (isRoomReachable(candidate)) {
      return candidate;
    }
  }
  const fallback = pool.find((t) => isRoomReachable(t));
  if (!fallback) {
    throw new Error('pickTemplate: no reachable template in pool');
  }
  return fallback;
}

/**
 * 骨架 (切片 (a), 5 间): 入口 → 战斗 → 分支(战斗|宝箱) → 商店 → 精英。
 * 商店是精英前的固定格。(b) 在末尾追加 fixed boss, 共 6 间。
 */
export const STAGE_SKELETON: StageSlot[] = [
  { kind: 'fixed', type: 'entrance' },
  { kind: 'fixed', type: 'combat' },
  { kind: 'choice', options: ['combat', 'chest'] },
  { kind: 'fixed', type: 'shop' },
  { kind: 'fixed', type: 'elite' },
];

/**
 * 开局按种子生成整条链: 每个槽位抽好候选模板 (choice 槽抽两个),
 * 选门时提交该槽位的 chosen, 不重抽、不重 roll。
 */
export function generateStage(seed: number): StageChain {
  const rng = mulberry32(seed);
  const slots: SlotInstance[] = STAGE_SKELETON.map((slot) => {
    if (slot.kind === 'fixed') {
      return {
        slot,
        candidates: [pickTemplate(TEMPLATES_BY_TYPE[slot.type], rng)],
        chosen: 0 as number | null,
      };
    }
    return {
      slot,
      candidates: [
        pickTemplate(TEMPLATES_BY_TYPE[slot.options[0]], rng),
        pickTemplate(TEMPLATES_BY_TYPE[slot.options[1]], rng),
      ],
      chosen: null as number | null,
    };
  });
  return { seed, slots };
}

/**
 * 链签名: 槽位类型 + 候选模板 id + chosen, 供 E2E 跨局比较
 * (同一种子链相同、重试链相同、分支 chosen 恢复为 null)。
 */
export function chainSignature(chain: StageChain): string {
  return chain.slots
    .map((s) => {
      const kind =
        s.slot.kind === 'fixed' ? s.slot.type : `choice(${s.slot.options.join('|')})`;
      const cands = s.candidates.map((c) => c.id).join('/');
      const chosen = s.chosen === null ? 'null' : String(s.chosen);
      return `${kind}:${cands}:${chosen}`;
    })
    .join('|');
}
