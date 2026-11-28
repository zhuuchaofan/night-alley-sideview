import { describe, expect, it } from 'vitest';
import {
  clampTouchKnobOffset,
  computeTouchMoveX,
  followTouchBase,
  TOUCH_JOYSTICK_DEADZONE,
  TOUCH_JOYSTICK_RADIUS,
} from '../../src/game/touchControls.ts';

describe('computeTouchMoveX', () => {
  it('死区内为 0 (含边界)', () => {
    expect(computeTouchMoveX(0)).toBe(0);
    expect(computeTouchMoveX(6.9)).toBe(0);
    expect(computeTouchMoveX(-7)).toBe(0);
    expect(computeTouchMoveX(7)).toBe(0);
  });

  it('线性重映射: 死区边为 0, 半径边为满幅, 无跳变', () => {
    expect(computeTouchMoveX(7.1)).toBeGreaterThan(0);
    expect(computeTouchMoveX(7.1)).toBeLessThan(0.01);
    // 中点 (7+50)/2 = 28.5 → 0.5
    expect(computeTouchMoveX(28.5)).toBeCloseTo(0.5, 9);
    expect(computeTouchMoveX(-28.5)).toBeCloseTo(-0.5, 9);
    expect(computeTouchMoveX(50)).toBe(1);
    expect(computeTouchMoveX(-50)).toBe(-1);
  });

  it('超出半径钳制在 ±1', () => {
    expect(computeTouchMoveX(120)).toBe(1);
    expect(computeTouchMoveX(-200)).toBe(-1);
  });
});

describe('followTouchBase', () => {
  it('半径内底座不动', () => {
    expect(followTouchBase(100, 140)).toBe(100);
    expect(followTouchBase(100, 60)).toBe(100);
    expect(followTouchBase(100, 150)).toBe(100);
  });

  it('超出半径时底座向手指滑动, 手指与底座距离恒为半径', () => {
    const origin = followTouchBase(100, 180);
    expect(origin).toBe(130);
    expect(180 - origin).toBe(TOUCH_JOYSTICK_RADIUS);
    const originL = followTouchBase(100, 10);
    expect(originL).toBe(60);
    expect(originL - 10).toBe(TOUCH_JOYSTICK_RADIUS);
  });
});

describe('clampTouchKnobOffset', () => {
  it('钳制在 ±半径', () => {
    expect(clampTouchKnobOffset(30)).toBe(30);
    expect(clampTouchKnobOffset(80)).toBe(TOUCH_JOYSTICK_RADIUS);
    expect(clampTouchKnobOffset(-80)).toBe(-TOUCH_JOYSTICK_RADIUS);
  });

  it('死区与半径常量符合任务书', () => {
    expect(TOUCH_JOYSTICK_DEADZONE).toBe(7);
    expect(TOUCH_JOYSTICK_RADIUS).toBe(50);
  });
});
