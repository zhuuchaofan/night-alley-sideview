/**
 * 触屏操作 DOM 覆盖层 (只在 coarse pointer 设备上创建)。
 *
 * 布局按 CSS 像素算, 覆盖在 #game-container (即画布) 之上:
 * 根容器 pointer-events:none, 只有左半边摇杆区与右侧按钮接事件,
 * 其余区域透传给画布 (门点击、菜单卡片点选不受影响)。
 * 按钮用 DOM 文本 + 系统字, 不新增像素字形、不碰字库。
 */
import {
  clampTouchKnobOffset,
  computeTouchMoveX,
  followTouchBase,
  TOUCH_JOYSTICK_KNOB_RADIUS,
  TOUCH_JOYSTICK_RADIUS,
} from './touchControls.ts';

export interface TouchControlCallbacks {
  onMove(x: number): void;
  onJump(): void;
  onAttackDown(): void;
  onAttackUp(): void;
  /** 覆盖层隐藏/销毁时取消按住的攻击 (只清标志, 不触发挥剑)。 */
  onAttackCancel(): void;
  onRoll(): void;
  onDash(): void;
  onSwitchForm(): void;
  onOpenShop(): void;
}

export interface TouchOverlay {
  setEnabled(enabled: boolean): void;
  setShopAvailable(available: boolean): void;
  destroy(): void;
}

const COARSE_POINTER_QUERY = '(pointer: coarse)';

export function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(COARSE_POINTER_QUERY).matches
  );
}

interface TouchButtonDef {
  id: string;
  label: string;
  ariaLabel: string;
  row: 1 | 2;
  right: number;
  size: number;
  action: 'jump' | 'attack' | 'roll' | 'dash' | 'switch' | 'shop';
}

const BUTTONS: TouchButtonDef[] = [
  { id: 'touch-btn-attack', label: '攻', ariaLabel: '攻击', row: 1, right: 12, size: 64, action: 'attack' },
  { id: 'touch-btn-jump', label: '跳', ariaLabel: '跳跃', row: 1, right: 88, size: 56, action: 'jump' },
  { id: 'touch-btn-switch', label: '切', ariaLabel: '切换形态', row: 1, right: 156, size: 56, action: 'switch' },
  { id: 'touch-btn-dash', label: '疾', ariaLabel: '疾攻', row: 2, right: 12, size: 52, action: 'dash' },
  { id: 'touch-btn-roll', label: '翻', ariaLabel: '翻滚', row: 2, right: 88, size: 52, action: 'roll' },
  { id: 'touch-btn-shop', label: '开店', ariaLabel: '开店', row: 2, right: 156, size: 52, action: 'shop' },
];

export function createTouchOverlay(
  container: HTMLElement,
  cb: TouchControlCallbacks,
): TouchOverlay | null {
  if (!isCoarsePointer()) {
    return null;
  }

  const abort = new AbortController();
  const { signal } = abort;

  const root = document.createElement('div');
  root.id = 'touch-overlay';

  const zone = document.createElement('div');
  zone.id = 'touch-stick-zone';
  root.appendChild(zone);

  const base = document.createElement('div');
  base.id = 'touch-stick-base';
  base.style.width = `${TOUCH_JOYSTICK_RADIUS * 2}px`;
  base.style.height = `${TOUCH_JOYSTICK_RADIUS * 2}px`;
  const knob = document.createElement('div');
  knob.id = 'touch-stick-knob';
  knob.style.width = `${TOUCH_JOYSTICK_KNOB_RADIUS * 2}px`;
  knob.style.height = `${TOUCH_JOYSTICK_KNOB_RADIUS * 2}px`;
  base.appendChild(knob);
  root.appendChild(base);

  let shopButton: HTMLButtonElement | null = null;
  let shopAvailable = false;
  for (const def of BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = def.id;
    btn.className = 'touch-btn';
    btn.textContent = def.label;
    btn.setAttribute('aria-label', def.ariaLabel);
    btn.style.width = `${def.size}px`;
    btn.style.height = `${def.size}px`;
    btn.style.right = `${def.right}px`;
    btn.style.bottom = def.row === 1 ? '27%' : 'calc(27% + 76px)';
    if (def.label === '开店') {
      btn.style.fontSize = '17px';
    }
    // 攻击按钮是唯一按住态按钮: 只接受首次落指的 pointerId, 第二指忽略;
    // pointercancel 是系统接管手势 (来电/通知/浏览器手势), 不结算挥剑, 只清状态
    // (Codex r1 B2: 原先 cancel 与松手共用回调、且任意一指抬起都会释放蓄力)。
    let attackPointerId: number | null = null;
    btn.addEventListener(
      'pointerdown',
      (e) => {
        if (def.action === 'attack') {
          if (attackPointerId !== null) {
            return;
          }
          attackPointerId = e.pointerId;
        }
        e.preventDefault();
        btn.classList.add('pressed');
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          // 旧浏览器无 pointer capture 也能用: pointerup 仍会冒泡到按钮。
        }
        switch (def.action) {
          case 'jump':
            cb.onJump();
            break;
          case 'attack':
            cb.onAttackDown();
            break;
          case 'roll':
            cb.onRoll();
            break;
          case 'dash':
            cb.onDash();
            break;
          case 'switch':
            cb.onSwitchForm();
            break;
          case 'shop':
            cb.onOpenShop();
            break;
        }
      },
      { signal },
    );
    const releaseUp = (e: PointerEvent): void => {
      btn.classList.remove('pressed');
      if (def.action === 'attack') {
        if (e.pointerId !== attackPointerId) {
          return;
        }
        attackPointerId = null;
        cb.onAttackUp();
      }
    };
    const releaseCancel = (e: PointerEvent): void => {
      btn.classList.remove('pressed');
      if (def.action === 'attack') {
        if (e.pointerId !== attackPointerId) {
          return;
        }
        attackPointerId = null;
        cb.onAttackCancel();
      }
    };
    btn.addEventListener('pointerup', releaseUp, { signal });
    btn.addEventListener('pointercancel', releaseCancel, { signal });
    root.appendChild(btn);
    if (def.action === 'shop') {
      shopButton = btn;
      btn.style.display = 'none';
    }
  }

  // 摇杆: 只跟首次落指的 pointerId, 浮动原点 + 跟随底座, 只取横向。
  let activePointerId: number | null = null;
  let originClientX = 0;

  const hideStick = (): void => {
    base.style.display = 'none';
  };
  hideStick();

  const resetStick = (): void => {
    activePointerId = null;
    hideStick();
    cb.onMove(0);
  };

  zone.addEventListener(
    'pointerdown',
    (e) => {
      if (activePointerId !== null) {
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) {
        return;
      }
      e.preventDefault();
      activePointerId = e.pointerId;
      originClientX = e.clientX;
      const rect = root.getBoundingClientRect();
      base.style.left = `${e.clientX - rect.left}px`;
      base.style.top = `${e.clientY - rect.top}px`;
      knob.style.transform = 'translate(-50%, -50%)';
      base.style.display = 'block';
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        // 无 capture 时手指滑出区域仍可能丢事件, 见实机验证项。
      }
      cb.onMove(0);
    },
    { signal },
  );

  zone.addEventListener(
    'pointermove',
    (e) => {
      if (activePointerId === null || e.pointerId !== activePointerId) {
        return;
      }
      e.preventDefault();
      originClientX = followTouchBase(originClientX, e.clientX);
      const dx = e.clientX - originClientX;
      const rect = root.getBoundingClientRect();
      base.style.left = `${originClientX - rect.left}px`;
      knob.style.transform = `translate(-50%, -50%) translateX(${clampTouchKnobOffset(dx)}px)`;
      cb.onMove(computeTouchMoveX(dx));
    },
    { signal },
  );

  const endStick = (e: PointerEvent): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) {
      return;
    }
    resetStick();
  };
  zone.addEventListener('pointerup', endStick, { signal });
  zone.addEventListener('pointercancel', endStick, { signal });

  container.appendChild(root);

  let enabled = true;
  const applyShopVisibility = (): void => {
    if (shopButton) {
      shopButton.style.display = enabled && shopAvailable ? '' : 'none';
    }
  };

  return {
    setEnabled(next: boolean): void {
      if (enabled === next) {
        return;
      }
      enabled = next;
      root.style.display = next ? '' : 'none';
      if (!next) {
        resetStick();
        cb.onAttackCancel();
      }
      applyShopVisibility();
    },
    setShopAvailable(available: boolean): void {
      shopAvailable = available;
      applyShopVisibility();
    },
    destroy(): void {
      abort.abort();
      resetStick();
      cb.onAttackCancel();
      root.remove();
    },
  };
}
