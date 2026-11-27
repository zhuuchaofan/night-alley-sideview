import { describe, expect, it } from 'vitest';
import {
  applySideKnockbackImpulse,
  canMergeSideDamageNumber,
  compensatePlayerBodyScale,
  computeSideCoinScatterOffset,
  computeSideCoinScatterVelocity,
  decaySideKnockbackOffset,
  formatSideDamageNumber,
  SIDE_KNOCKBACK_MAX,
} from '../../src/game/sideFeel.ts';

describe('applySideKnockbackImpulse', () => {
  it('pushes light hits a short way in the hit direction', () => {
    expect(applySideKnockbackImpulse(0, 0, 1, false)).toEqual({ x: 8, y: 0 });
    expect(applySideKnockbackImpulse(0, 0, -1, false)).toEqual({ x: -8, y: 0 });
  });

  it('pushes heavy hits further and lifts the visual a touch', () => {
    expect(applySideKnockbackImpulse(0, 0, 1, true)).toEqual({ x: 14, y: -4 });
  });

  it('accumulates but never exceeds the cap', () => {
    let offset = { x: 0, y: 0 };
    for (let i = 0; i < 5; i += 1) {
      offset = applySideKnockbackImpulse(offset.x, offset.y, 1, true);
    }
    expect(Math.hypot(offset.x, offset.y)).toBeLessThanOrEqual(SIDE_KNOCKBACK_MAX + 1e-9);
    expect(offset.x).toBeGreaterThan(0);
  });
});

describe('decaySideKnockbackOffset', () => {
  it('decays to exactly zero', () => {
    let offset = { x: 12, y: -4 };
    for (let i = 0; i < 60; i += 1) {
      offset = decaySideKnockbackOffset(offset.x, offset.y, 1 / 60);
    }
    expect(offset).toEqual({ x: 0, y: 0 });
  });

  it('leaves zero alone and ignores non-positive dt', () => {
    expect(decaySideKnockbackOffset(0, 0, 0.016)).toEqual({ x: 0, y: 0 });
    expect(decaySideKnockbackOffset(5, 0, 0)).toEqual({ x: 5, y: 0 });
  });
});

describe('canMergeSideDamageNumber', () => {
  it('merges a quick second hit on the same enemy', () => {
    expect(
      canMergeSideDamageNumber({ enemyId: 3, sinceLastHit: 0.1, totalLife: 0.3 }, 3),
    ).toBe(true);
  });

  it('refuses other enemies, stale hits, and over-lived numbers', () => {
    expect(
      canMergeSideDamageNumber({ enemyId: 3, sinceLastHit: 0.1, totalLife: 0.3 }, 4),
    ).toBe(false);
    expect(
      canMergeSideDamageNumber({ enemyId: 3, sinceLastHit: 0.3, totalLife: 0.3 }, 3),
    ).toBe(false);
    expect(
      canMergeSideDamageNumber({ enemyId: 3, sinceLastHit: 0.1, totalLife: 0.7 }, 3),
    ).toBe(false);
  });
});

describe('formatSideDamageNumber', () => {
  it('formats integers and clamps to at least 1', () => {
    expect(formatSideDamageNumber(6)).toBe('6');
    expect(formatSideDamageNumber(12)).toBe('12');
    expect(formatSideDamageNumber(0)).toBe('1');
  });
});

describe('coin scatter', () => {
  it('starts and ends at zero offset and peaks mid-flight', () => {
    const v = computeSideCoinScatterVelocity(() => 0.5);
    const atStart = computeSideCoinScatterOffset(v.vx, v.vy, v.hopPeak, v.duration, v.duration);
    const atEnd = computeSideCoinScatterOffset(v.vx, v.vy, v.hopPeak, 0, v.duration);
    const mid = computeSideCoinScatterOffset(v.vx, v.vy, v.hopPeak, v.duration / 2, v.duration);
    // toBeCloseTo: a negative velocity times a zero arc is -0, still zero.
    expect(atStart.x).toBeCloseTo(0);
    expect(atStart.y).toBeCloseTo(0);
    expect(atEnd.x).toBeCloseTo(0);
    expect(atEnd.y).toBeCloseTo(0);
    expect(Math.hypot(mid.x, mid.y)).toBeGreaterThan(0);
  });

  it('pops upward mid-flight and never sinks far below its rest spot', () => {
    // No radial velocity: the hop alone lifts the coin.
    const hopOnly = computeSideCoinScatterOffset(0, 0, 9, 0.12, 0.24);
    expect(hopOnly.y).toBeLessThan(0);
    // Worst case: max downward velocity (125) against the 9px hop.
    const worstDown = computeSideCoinScatterOffset(0, 125, 9, 0.12, 0.24);
    expect(worstDown.y).toBeLessThanOrEqual(3.01);
  });
});

describe('compensatePlayerBodyScale', () => {
  it('is the identity at scale 1', () => {
    expect(compensatePlayerBodyScale(1, 1)).toEqual({
      width: 28,
      height: 48,
      offsetX: 18,
      offsetY: 6,
    });
  });

  it('keeps the effective body at 28x48 in the same place when squashed', () => {
    // Effective body: width = sourceWidth * |sx|,
    // position.x = sprite.x + sx * (offset.x - displayOriginX), origin 32.
    const sx = 1.2;
    const sy = 0.8;
    const comp = compensatePlayerBodyScale(sx, sy);
    expect(comp.width * sx).toBeCloseTo(28);
    expect(comp.height * sy).toBeCloseTo(48);
    expect(sx * (comp.offsetX - 32)).toBeCloseTo(18 - 32);
    expect(sy * (comp.offsetY - 32)).toBeCloseTo(6 - 32);
  });
});
