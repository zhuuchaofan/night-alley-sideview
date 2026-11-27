import {
  SIDE_ENEMY_BODY_HEIGHT,
  SIDE_ENEMY_BODY_OFFSET_X,
  SIDE_ENEMY_BODY_OFFSET_Y,
  SIDE_ENEMY_BODY_WIDTH,
} from './balance.ts';

/**
 * S1.5 game-feel tuning for the side-view prototype — presentation only.
 *
 * Nothing here changes gameplay numbers: damage, HP, cooldowns, speeds and
 * stun durations all live in balance.ts. These constants and pure functions
 * only drive visuals (hitstop, flashes, render-only knockback offsets,
 * damage-number merging, coin scatter arcs, squash & stretch).
 *
 * The rule, inherited from the top-down arena game: presentation must never
 * move logic. Enemy knockback and coin scatter are render-only offsets on
 * top of logical positions; the physics body is never pushed by a hit.
 */

export interface Offset2D {
  x: number;
  y: number;
}

export interface DamageMergeCandidate {
  enemyId: number;
  sinceLastHit: number;
  totalLife: number;
}

export interface CoinScatterVelocity {
  vx: number;
  vy: number;
  duration: number;
  hopPeak: number;
}

export interface PlayerBodyCompensation {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/** Enemy hit-flash duration (seconds). S1 used 0.1; the task fixes 0.12. */
export const SIDE_HIT_FLASH_SECONDS = 0.12;
/** Light sword-hit hitstop (ms). Heavy stays 90ms (SIDE_HEAVY_HITSTOP_MS). */
export const SIDE_LIGHT_HITSTOP_MS = 40;
/** Small camera shake on a kill (ms / intensity; intensity is a fraction of camera size). */
export const SIDE_KILL_SHAKE_MS = 60;
export const SIDE_KILL_SHAKE_INTENSITY = 0.005;
/** Camera shake when the player takes a hit. */
export const SIDE_HURT_SHAKE_MS = 90;
export const SIDE_HURT_SHAKE_INTENSITY = 0.006;

/** Floating damage number: rise time for a fresh number (ms). */
export const SIDE_DAMAGE_NUMBER_DURATION_MS = 420;
/** Hits on the same enemy inside this window (s) merge into one number. */
export const SIDE_DAMAGE_NUMBER_MERGE_WINDOW = 0.22;
/** A merged number never lives longer than this (s) from creation. */
export const SIDE_DAMAGE_NUMBER_MAX_MERGED_LIFE = 0.65;
/** Max floating damage numbers on screen at once. */
export const SIDE_MAX_DAMAGE_NUMBERS = 18;
/** How far a damage number rises (px). */
export const SIDE_DAMAGE_NUMBER_RISE_PX = 24;

/** Render-only knockback offset (px): light / heavy impulse, hard cap, decay. */
export const SIDE_KNOCKBACK_IMPULSE_LIGHT = 8;
export const SIDE_KNOCKBACK_IMPULSE_HEAVY = 14;
export const SIDE_KNOCKBACK_MAX = 16;
export const SIDE_KNOCKBACK_DECAY_SPEED = 85;
/** Heavy hits also lift the enemy visual a touch (px, upward). */
export const SIDE_KNOCKBACK_POP_UP = 4;

/** Coin scatter arc: duration (s), hop height (px), visual scale of the arc. */
export const SIDE_COIN_SCATTER_DURATION = 0.24;
export const SIDE_COIN_SCATTER_HOP_PEAK = 9;
export const SIDE_COIN_SCATTER_VISUAL_SCALE = 0.4;

/** Afterimage ghosts during roll / dash: spawn interval (s), fade time (ms). */
export const SIDE_AFTERIMAGE_INTERVAL_SECONDS = 0.04;
export const SIDE_AFTERIMAGE_LIFETIME_MS = 200;
export const SIDE_ROLL_AFTERIMAGE_ALPHA = 0.25;
export const SIDE_DASH_AFTERIMAGE_ALPHA = 0.35;
/** Dash ghosts are stretched horizontally; roll ghosts are not. */
export const SIDE_DASH_AFTERIMAGE_STRETCH_X = 1.4;

/** Squash & stretch (scale factors, durations in seconds). */
export const SIDE_SQUASH_CROUCH = { sx: 1.2, sy: 0.8 };
export const SIDE_SQUASH_STRETCH = { sx: 0.88, sy: 1.12 };
export const SIDE_SQUASH_LAND = { sx: 1.15, sy: 0.85 };
export const SIDE_SQUASH_CROUCH_SECONDS = 0.08;
export const SIDE_SQUASH_STRETCH_SECONDS = 0.1;
export const SIDE_SQUASH_LAND_SECONDS = 0.08;

/** Player physics body (must match createPlayer's setSize/setOffset). */
export const SIDE_PLAYER_BODY_WIDTH = 28;
export const SIDE_PLAYER_BODY_HEIGHT = 48;
export const SIDE_PLAYER_BODY_OFFSET_X = 18;
export const SIDE_PLAYER_BODY_OFFSET_Y = 6;
/** Player texture is 64x64 with origin 0.5, so the display origin is 32. */
export const SIDE_PLAYER_TEXTURE_ORIGIN = 32;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Adds a bounded render-only knockback offset in `dirX` (+1 right, -1 left).
 * Heavy hits push further and lift the visual a touch. The logical body
 * position is untouched; the scene applies this offset on top of it.
 */
export function applySideKnockbackImpulse(
  currentX: number,
  currentY: number,
  dirX: number,
  isHeavy: boolean,
): Offset2D {
  const impulse = isHeavy ? SIDE_KNOCKBACK_IMPULSE_HEAVY : SIDE_KNOCKBACK_IMPULSE_LIGHT;
  let nextX = currentX + (dirX >= 0 ? impulse : -impulse);
  let nextY = currentY + (isHeavy ? -SIDE_KNOCKBACK_POP_UP : 0);
  const len = Math.hypot(nextX, nextY);
  if (len > SIDE_KNOCKBACK_MAX && len > 0.001) {
    const scale = SIDE_KNOCKBACK_MAX / len;
    nextX *= scale;
    nextY *= scale;
  }
  return { x: nextX, y: nextY };
}

/** Decays a render-only knockback offset smoothly back to zero. */
export function decaySideKnockbackOffset(offsetX: number, offsetY: number, dt: number): Offset2D {
  if (dt <= 0) {
    return { x: offsetX, y: offsetY };
  }
  const len = Math.hypot(offsetX, offsetY);
  if (len <= 0.001) {
    return { x: 0, y: 0 };
  }
  const nextLen = Math.max(0, len - SIDE_KNOCKBACK_DECAY_SPEED * dt);
  if (nextLen < 0.15) {
    return { x: 0, y: 0 };
  }
  const scale = nextLen / len;
  return { x: offsetX * scale, y: offsetY * scale };
}

/** Returns true if a new hit on `enemyId` should merge into an existing number. */
export function canMergeSideDamageNumber(
  entry: DamageMergeCandidate,
  enemyId: number,
): boolean {
  return (
    entry.enemyId === enemyId &&
    entry.sinceLastHit <= SIDE_DAMAGE_NUMBER_MERGE_WINDOW &&
    entry.totalLife <= SIDE_DAMAGE_NUMBER_MAX_MERGED_LIFE
  );
}

/** Formats damage as ASCII digits ('0'-'9') guaranteed to exist in the pixel font. */
export function formatSideDamageNumber(amount: number): string {
  return String(Math.max(1, Math.round(amount)));
}

/**
 * Initial scatter velocity for a single dropped coin (random direction).
 * The coin's logical position stays at the drop point; only the visual
 * offset (computeSideCoinScatterOffset) moves, and it decays back to zero.
 */
export function computeSideCoinScatterVelocity(rng: () => number = Math.random): CoinScatterVelocity {
  const angle = rng() * Math.PI * 2;
  const speed = 80 + rng() * 45;
  return {
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    duration: SIDE_COIN_SCATTER_DURATION,
    hopPeak: SIDE_COIN_SCATTER_HOP_PEAK,
  };
}

/**
 * Visual-only scatter offset for a dropped coin. Peaks mid-flight and
 * decays smoothly back to (0, 0) as scatterTimer reaches 0. The radial
 * burst is always lifted by hopPeak, so a downward scatter velocity can
 * only dip the coin up to ~3px below its rest position at mid-flight.
 */
export function computeSideCoinScatterOffset(
  vx: number,
  vy: number,
  hopPeak: number,
  scatterTimer: number,
  scatterMaxTimer: number,
): Offset2D {
  if (scatterTimer <= 0 || scatterMaxTimer <= 0) {
    return { x: 0, y: 0 };
  }
  const progress = clamp(1 - scatterTimer / scatterMaxTimer, 0, 1);
  const arc = Math.sin(progress * Math.PI);
  const factor = scatterMaxTimer * SIDE_COIN_SCATTER_VISUAL_SCALE * arc;
  return {
    x: vx * factor,
    y: vy * factor - hopPeak * arc,
  };
}

function compensateBodyScale(
  baseWidth: number,
  baseHeight: number,
  baseOffsetX: number,
  baseOffsetY: number,
  origin: number,
  sx: number,
  sy: number,
): PlayerBodyCompensation {
  const safeSx = Math.abs(sx) < 0.01 ? 0.01 : sx;
  const safeSy = Math.abs(sy) < 0.01 ? 0.01 : sy;
  return {
    width: baseWidth / safeSx,
    height: baseHeight / safeSy,
    offsetX: origin + (baseOffsetX - origin) / safeSx,
    offsetY: origin + (baseOffsetY - origin) / safeSy,
  };
}

/**
 * Body size/offset that keeps the player's physics body exactly at
 * 28x48 in the same place while the sprite is visually scaled to (sx, sy).
 *
 * Phaser Arcade derives the body from the sprite: width = sourceWidth * |sx|
 * and position.x = sprite.x + sx * (offset.x - displayOriginX). Dividing the
 * source size and un-shifting the offset by the scale cancels both, so the
 * squash & stretch stays purely visual. Call with (1, 1) to restore.
 */
export function compensatePlayerBodyScale(sx: number, sy: number): PlayerBodyCompensation {
  return compensateBodyScale(
    SIDE_PLAYER_BODY_WIDTH,
    SIDE_PLAYER_BODY_HEIGHT,
    SIDE_PLAYER_BODY_OFFSET_X,
    SIDE_PLAYER_BODY_OFFSET_Y,
    SIDE_PLAYER_TEXTURE_ORIGIN,
    sx,
    sy,
  );
}

/**
 * Body size/offset that keeps an enemy's physics body fixed at 28x46
 * regardless of visual scale (elite 1.25x, boss 1.6x, contact flash 1.18x).
 */
export function compensateEnemyBodyScale(sx: number, sy: number = sx): PlayerBodyCompensation {
  return compensateBodyScale(
    SIDE_ENEMY_BODY_WIDTH,
    SIDE_ENEMY_BODY_HEIGHT,
    SIDE_ENEMY_BODY_OFFSET_X,
    SIDE_ENEMY_BODY_OFFSET_Y,
    SIDE_PLAYER_TEXTURE_ORIGIN,
    sx,
    sy,
  );
}

/** Strict AABB overlap check: touching edges (zero overlap) return false. */
export function rectsStrictlyOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
