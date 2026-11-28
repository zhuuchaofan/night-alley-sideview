/**
 * 触屏横向摇杆的纯数学部分 (CSS px 为单位, 与 DOM/Phaser 无关):
 * 死区 7、半径 50、旋钮 14, 线性重映射 (d-7)/(50-7)。
 * 只取横向: 摇杆只输出左右移动, 纵向拖动不产生输入。
 */
export const TOUCH_JOYSTICK_RADIUS = 50;
export const TOUCH_JOYSTICK_DEADZONE = 7;
export const TOUCH_JOYSTICK_KNOB_RADIUS = 14;

/** 横向拖动 dx (相对原点, CSS px) → 归一化移动量 [-1, 1]。 */
export function computeTouchMoveX(
  dx: number,
  deadzone: number = TOUCH_JOYSTICK_DEADZONE,
  radius: number = TOUCH_JOYSTICK_RADIUS,
): number {
  const d = Math.abs(dx);
  if (d <= deadzone) {
    return 0;
  }
  if (d >= radius) {
    return Math.sign(dx);
  }
  return (Math.sign(dx) * (d - deadzone)) / (radius - deadzone);
}

/**
 * 跟随底座: 手指超出半径时底座向手指滑动, 使手指与底座中心的距离
 * 恒不超过半径 (旋钮贴边), 反向只需一个半径的行程。
 * 只算横向。
 */
export function followTouchBase(
  originX: number,
  currentX: number,
  radius: number = TOUCH_JOYSTICK_RADIUS,
): number {
  const dx = currentX - originX;
  const d = Math.abs(dx);
  if (d <= radius) {
    return originX;
  }
  return originX + Math.sign(dx) * (d - radius);
}

/** 旋钮相对底座中心的横向偏移, 钳制在 [-radius, radius]。 */
export function clampTouchKnobOffset(
  dx: number,
  radius: number = TOUCH_JOYSTICK_RADIUS,
): number {
  return Math.max(-radius, Math.min(radius, dx));
}
