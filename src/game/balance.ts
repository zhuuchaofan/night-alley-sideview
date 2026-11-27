export const ARENA_WIDTH = 960;
export const ARENA_HEIGHT = 540;
export const HUD_HEIGHT = 44;
export const ROUND_DURATION_SECONDS = 180;
export const SPAWN_MARGIN = 30;
export const MAX_ENEMIES = 65;

export const PLAYER_MAX_HP = 30;
export const PLAYER_SPEED = 160;
export const PLAYER_RADIUS = 12;
export const PLAYER_COLOR = 0xe8b34b;
export const PLAYER_PICKUP_RADIUS = 60;

export const XP_PER_ORB = 1;
export const ORB_RADIUS = 4;
export const ORB_PULL_SPEED = 420;

export const ENEMY_BASE_HP = 8;
export const ENEMY_HP_STEP_SECONDS = 30;
export const ENEMY_BASE_SPEED = 55;
export const ENEMY_SPEED_MAX_BONUS = 0.4;
export const ENEMY_CONTACT_DAMAGE = 1;
export const ENEMY_ATTACK_COOLDOWN = 0.5;
export const ENEMY_RADIUS = 10;
export const ENEMY_COLOR = 0x9a8fb5;

export type SpawnEnemyKind = 'paper' | 'lantern' | 'swift' | 'shooter' | 'elite';
export type EnemyKind = SpawnEnemyKind | 'boss';

export const SWIFT_HP = 2;
export const SWIFT_SPEED_MULT = 1.5;
export const SWIFT_RADIUS = 8;

export const SHOOTER_SPEED_MULT = 0.8;
export const SHOOTER_RADIUS = ENEMY_RADIUS;
export const SHOOTER_RANGE = 200;
export const SHOOTER_RETREAT_DIST = 120;
export const SHOOTER_FIRE_COOLDOWN = 3.0;
export const SHOOTER_BOLT_SPEED = 110;
export const SHOOTER_BOLT_RADIUS = 5;
export const SHOOTER_BOLT_DAMAGE = 1;

export const ELITE_HP_MULT = 4.5;
export const ELITE_SPEED_MULT = 0.85;
export const ELITE_RADIUS = 14;
export const ELITE_XP_ORBS = 3;

export const SPAWN_WEIGHT_ELITE = 0.008;
export const SPAWN_WEIGHT_SWIFT_MAX = 0.25;
export const SPAWN_WEIGHT_SWIFT_RAMP_END = 120;
export const SPAWN_WEIGHT_SHOOTER_RAMP_START = 30;
export const SPAWN_WEIGHT_SHOOTER_RAMP_END = 120;
export const SPAWN_WEIGHT_SHOOTER_MAX = 0.15;

export const BOSS_SPAWN_ELAPSED_SECONDS = 150;
export const BOSS_MAX_HP = 120;
export const BOSS_SPEED = 85;
export const BOSS_CONTACT_DAMAGE = 4;
export const BOSS_ATTACK_COOLDOWN = 1.75;
export const BOSS_RADIUS = 24;
export const BOSS_XP_ORBS = 20;

export type WeaponId = 'peach_sword' | 'coin_dart' | 'lantern_fire';

export const WEAPON_ORDER: WeaponId[] = ['peach_sword', 'coin_dart', 'lantern_fire'];

export interface WeaponDef {
  id: WeaponId;
  name: string;
  cooldown: number;
  range: number;
  arcDeg: number;
  damage: number;
  count: number;
  projectileSpeed: number;
  duration: number;
  tickInterval: number;
}

export const WEAPON_DEFS: Record<WeaponId, WeaponDef> = {
  peach_sword: {
    id: 'peach_sword',
    name: '桃木剑',
    cooldown: 0.8,
    range: 90,
    arcDeg: 100,
    damage: 6,
    count: 1,
    projectileSpeed: 0,
    duration: 0,
    tickInterval: 0,
  },
  coin_dart: {
    id: 'coin_dart',
    name: '铜钱镖',
    cooldown: 1.2,
    range: 320,
    arcDeg: 0,
    damage: 5,
    count: 1,
    projectileSpeed: 420,
    duration: 0,
    tickInterval: 0,
  },
  lantern_fire: {
    id: 'lantern_fire',
    name: '灯笼火',
    cooldown: 2.0,
    range: 90,
    arcDeg: 0,
    damage: 1.5,
    count: 1,
    projectileSpeed: 0,
    duration: 2.0,
    tickInterval: 0.5,
  },
};

export const EVOLUTION_MIN_LEVEL = 5;

export interface EvolutionDef {
  name: string;
  damageMultiplier: number;
  arcDegBonus?: number;
  countBonus?: number;
  rangeMultiplier?: number;
}

export const EVOLUTION_DEFS: Record<WeaponId, EvolutionDef> = {
  peach_sword: {
    name: '破魔法剑',
    damageMultiplier: 2,
    arcDegBonus: 40,
  },
  coin_dart: {
    name: '九连钱镖',
    damageMultiplier: 1.5,
    countBonus: 2,
  },
  lantern_fire: {
    name: '照夜魂灯',
    damageMultiplier: 2,
    rangeMultiplier: 1.5,
  },
};

export interface WeaponState {
  id: WeaponId;
  level: number;
  evolved: boolean;
  cooldown: number;
  range: number;
  arcDeg: number;
  damage: number;
  count: number;
  projectileSpeed: number;
  duration: number;
  tickInterval: number;
}

export interface PlayerStats {
  hp: number;
  maxHp: number;
  speed: number;
  pickupRadius: number;
  damageMultiplier: number;
  weapons: Partial<Record<WeaponId, WeaponState>>;
}

export interface EnemyStats {
  maxHp: number;
  speed: number;
  contactDamage: number;
  attackCooldown: number;
  radius: number;
}

export const BOSS_STATS: Readonly<EnemyStats> = {
  maxHp: BOSS_MAX_HP,
  speed: BOSS_SPEED,
  contactDamage: BOSS_CONTACT_DAMAGE,
  attackCooldown: BOSS_ATTACK_COOLDOWN,
  radius: BOSS_RADIUS,
};

/** XP required to advance from `level` to `level + 1`. */
export function xpNeededForLevel(level: number): number {
  return 5 + level * 3;
}

/** Spawn interval (seconds) at `elapsedSeconds`. */
export function spawnIntervalAt(elapsedSeconds: number): number {
  const t = Math.max(0, elapsedSeconds);
  return Math.max(0.35, 1.2 - t * 0.004);
}

/** Enemy attributes at `elapsedSeconds`. */
export function enemyStatsAt(elapsedSeconds: number): EnemyStats {
  const t = Math.max(0, elapsedSeconds);
  return {
    maxHp: ENEMY_BASE_HP + Math.floor(t / ENEMY_HP_STEP_SECONDS),
    speed: ENEMY_BASE_SPEED * (1 + (t / ROUND_DURATION_SECONDS) * ENEMY_SPEED_MAX_BONUS),
    contactDamage: ENEMY_CONTACT_DAMAGE,
    attackCooldown: ENEMY_ATTACK_COOLDOWN,
    radius: ENEMY_RADIUS,
  };
}

/** Enemy attributes for a specific spawn kind at `elapsedSeconds`. */
export function enemyStatsForKind(kind: SpawnEnemyKind, elapsedSeconds: number): EnemyStats {
  const base = enemyStatsAt(elapsedSeconds);
  if (kind === 'swift') {
    return {
      ...base,
      maxHp: SWIFT_HP,
      speed: base.speed * SWIFT_SPEED_MULT,
      radius: SWIFT_RADIUS,
    };
  }
  if (kind === 'shooter') {
    return {
      ...base,
      speed: base.speed * SHOOTER_SPEED_MULT,
      radius: SHOOTER_RADIUS,
    };
  }
  if (kind === 'elite') {
    return {
      ...base,
      maxHp: Math.floor(base.maxHp * ELITE_HP_MULT),
      speed: base.speed * ELITE_SPEED_MULT,
      radius: ELITE_RADIUS,
    };
  }
  return base;
}

/** Spawn weights for each non-boss enemy kind at `elapsedSeconds` (sum = 1). */
export function spawnWeightsAt(elapsedSeconds: number): Record<SpawnEnemyKind, number> {
  const t = Math.max(0, elapsedSeconds);
  const elite = SPAWN_WEIGHT_ELITE;
  const swift = SPAWN_WEIGHT_SWIFT_MAX * Math.min(1, t / SPAWN_WEIGHT_SWIFT_RAMP_END);
  const shooter =
    t <= SPAWN_WEIGHT_SHOOTER_RAMP_START
      ? 0
      : SPAWN_WEIGHT_SHOOTER_MAX *
        Math.min(
          1,
          (t - SPAWN_WEIGHT_SHOOTER_RAMP_START) /
            (SPAWN_WEIGHT_SHOOTER_RAMP_END - SPAWN_WEIGHT_SHOOTER_RAMP_START),
        );
  const remaining = Math.max(0, 1 - elite - swift - shooter);
  const lantern = remaining / 3;
  const paper = remaining - lantern;
  return { paper, lantern, swift, shooter, elite };
}

/** Pick a non-boss enemy kind using the time-varying weights at `elapsedSeconds`. */
export function pickSpawnKind(elapsedSeconds: number, rng01: number): SpawnEnemyKind {
  const w = spawnWeightsAt(elapsedSeconds);
  let r = Math.max(0, Math.min(0.999999999999, rng01));
  if (r < w.elite) return 'elite';
  r -= w.elite;
  if (r < w.swift) return 'swift';
  r -= w.swift;
  if (r < w.shooter) return 'shooter';
  r -= w.shooter;
  if (r < w.lantern) return 'lantern';
  return 'paper';
}

/** Create initial runtime state for a weapon. */
export function createInitialWeapon(id: WeaponId): WeaponState {
  const def = WEAPON_DEFS[id];
  return {
    id: def.id,
    level: 1,
    evolved: false,
    cooldown: def.cooldown,
    range: def.range,
    arcDeg: def.arcDeg,
    damage: def.damage,
    count: def.count,
    projectileSpeed: def.projectileSpeed,
    duration: def.duration,
    tickInterval: def.tickInterval,
  };
}

/** Return the weapon's evolved name when evolved, otherwise its base name. */
export function displayWeaponName(state: WeaponState): string {
  return state.evolved ? EVOLUTION_DEFS[state.id].name : WEAPON_DEFS[state.id].name;
}

/** Create starting player stats with the Peach Wood Sword equipped. */
export function createInitialPlayerStats(): PlayerStats {
  return {
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    speed: PLAYER_SPEED,
    pickupRadius: PLAYER_PICKUP_RADIUS,
    damageMultiplier: 1,
    weapons: {
      peach_sword: createInitialWeapon('peach_sword'),
    },
  };
}

/** Format seconds as MM:SS. */
export function formatTime(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const SIDE_GROUND_Y = 500;
export const SIDE_WALL_WIDTH = 64;
export const SIDE_GRAVITY = 1400;
export const SIDE_JUMP_VELOCITY = -520;
export const SIDE_SWING_WIDTH = 70;
export const SIDE_SWING_HEIGHT = 50;
export const SIDE_SWING_DAMAGE = 6;
export const SIDE_SWING_COOLDOWN = 0.25;
export const SIDE_SWING_KNOCKBACK = 60;
export const SIDE_CHARGE_THRESHOLD = 0.5;
export const SIDE_HEAVY_WIDTH = 140;
export const SIDE_HEAVY_HEIGHT = 64;
export const SIDE_HEAVY_DAMAGE = 12;
export const SIDE_HEAVY_KNOCKBACK = 200;
export const SIDE_HEAVY_HITSTOP_MS = 90;
export const SIDE_ROLL_DURATION = 0.3;
export const SIDE_ROLL_SPEED = 320;
export const SIDE_ROLL_COOLDOWN = 2.0;
export const SIDE_DASH_DURATION = 0.18;
export const SIDE_DASH_SPEED = 520;
export const SIDE_DASH_DAMAGE = 5;
export const SIDE_DASH_COOLDOWN = 0.5;
export const SIDE_INITIAL_ENEMIES = 5;
export const SIDE_ENEMY_CONTACT_COOLDOWN = 1.75;
export const SIDE_COIN_PICKUP_RADIUS = 40;
export const SIDE_ENEMY_BODY_WIDTH = 28;
export const SIDE_ENEMY_BODY_HEIGHT = 46;
export const SIDE_ENEMY_BODY_OFFSET_X = 18;
export const SIDE_ENEMY_BODY_OFFSET_Y = 8;

/**
 * 敌人精灵可见宽度 (display px): 32 格贴图可见列 × 2 (SPRITE_PIXEL_SCALE) × visualScale。
 * 由 src/data/pixelart.ts 实测: paper/lantern 列 5–26 (22 格), swift 列 2–27 (26 格),
 * shooter 列 3–29 (27 格), elite 列 1–30 (30 格), boss 列 0–31 (32 格)。
 * 怪分离按身体盒 28px 分时, 可见画 (44–54px) 仍重叠 16px 以上、画面糊成一团,
 * 所以分离改按可见宽度 (见 applyEnemySeparation); 身体盒仍是 28×46, 接触判定不动。
 */
export const SIDE_ENEMY_VISUAL_WIDTH: Record<EnemyKind, number> = {
  paper: 44,
  lantern: 44,
  swift: 52,
  shooter: 54,
  elite: 75,
  boss: 102,
};
/** 视觉分离空隙: 同层两怪可见边缘之间留的空隙 (白底贴图贴边仍会糊成一团)。 */
export const SIDE_ENEMY_VISUAL_GAP = 8;
/**
 * 分离余量: 分离把怪推到阈值 + 该余量的位置, 而不是恰好贴在阈值上。
 * 分离在 updateEnemies 里跑在物理步之前, 疾纸人冲锋一帧能逼近约 3px;
 * 没有余量时, 采样会在帧间抓到 1–3px 的瞬时越线 (live 回归初版: 6.7% 采样违例、
 * 全部是单采样孤立越线)。余量 6px 盖住单帧最大逼近, 静息间距恒在阈值之上。
 */
export const SIDE_ENEMY_SEPARATION_MARGIN = 6;

export interface SideEnemyConfig {
  kind: EnemyKind;
  maxHp: number;
  speed: number;
  contactDamage: number;
  attackCooldown: number;
  coinDrops: number;
  visualScale: number;
  visualWidth: number;
  stunScale: number;
}

/** 横板 6 种敌人数值配置 (以俯视角 balance 为起点, 接触间隔统一 1.75s)。 */
export function sideEnemyStatsForKind(kind: EnemyKind): SideEnemyConfig {
  if (kind === 'boss') {
    return {
      kind,
      maxHp: BOSS_MAX_HP,
      speed: BOSS_SPEED,
      contactDamage: BOSS_CONTACT_DAMAGE,
      attackCooldown: BOSS_ATTACK_COOLDOWN,
      coinDrops: 0,
      visualScale: 1.6,
      visualWidth: SIDE_ENEMY_VISUAL_WIDTH.boss,
      stunScale: 0.25,
    };
  }
  const base = enemyStatsForKind(kind, 0);
  if (kind === 'elite') {
    return {
      kind,
      maxHp: base.maxHp, // Math.floor(8 * 4.5) = 36
      speed: base.speed, // 55 * 0.85 = 46.75
      contactDamage: ENEMY_CONTACT_DAMAGE,
      attackCooldown: SIDE_ENEMY_CONTACT_COOLDOWN,
      coinDrops: ELITE_XP_ORBS, // 3
      visualScale: 1.25,
      visualWidth: SIDE_ENEMY_VISUAL_WIDTH.elite,
      stunScale: 0.5,
    };
  }
  return {
    kind,
    maxHp: base.maxHp,
    speed: base.speed,
    contactDamage: ENEMY_CONTACT_DAMAGE,
    attackCooldown: SIDE_ENEMY_CONTACT_COOLDOWN,
    coinDrops: 1,
    visualScale: 1,
    visualWidth: SIDE_ENEMY_VISUAL_WIDTH[kind],
    stunScale: 1,
  };
}
