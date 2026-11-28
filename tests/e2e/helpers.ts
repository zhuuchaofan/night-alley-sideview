import { Page } from '@playwright/test';
import type { SideviewDebugState } from '../../src/game/sideDebug.ts';

export async function waitForCanvasAndDebug(page: Page): Promise<void> {
  await page.waitForSelector('canvas', { state: 'visible' });
  await page.waitForFunction(() => Boolean(window.__SIDEVIEW_DEBUG__));
}

export async function getState(page: Page): Promise<SideviewDebugState> {
  return page.evaluate(() => {
    if (!window.__SIDEVIEW_DEBUG__) {
      throw new Error('Missing __SIDEVIEW_DEBUG__');
    }
    return window.__SIDEVIEW_DEBUG__.getState();
  });
}

/** 从标题开始一局; 传 seed 时先 setSeed (标题钩子只写待用种子, 点开始时消费一次)。 */
export async function startGame(page: Page, seed?: number): Promise<void> {
  await page.goto('/');
  await waitForCanvasAndDebug(page);
  if (seed !== undefined) {
    await page.evaluate((s) => {
      window.__SIDEVIEW_DEBUG__?.setSeed(s);
    }, seed);
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const box = await page.locator('canvas').boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('Canvas bounding box is empty');
  }
  await page.mouse.click(box.x + (480 / 960) * box.width, box.y + (300 / 540) * box.height);
  await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().scene === 'SideGameScene');
}

/** 杀光当前房间的敌人 (瞬移到最近敌人身旁挥剑)。零敌人房直接返回。
 * 每轮先回满血: 六间连清时站桩的玩家会被围殴致死, 回血只保 helper 走完流程。 */
export async function clearCurrentRoom(page: Page): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    const state = await getState(page);
    if (state.roomCleared || state.stageCleared) {
      return;
    }
    const target = state.enemyInfos?.[0];
    if (target) {
      await page.evaluate(
        ({ ex, eb }) => {
          window.__SIDEVIEW_DEBUG__?.setHp(30);
          const px = ex > 110 ? ex - 32 : ex + 32;
          window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(px, eb - 22);
        },
        { ex: target.x, eb: target.bodyBottom },
      );
      if (target.x <= 110) {
        await page.keyboard.down('KeyA');
        await page.waitForTimeout(40);
        await page.keyboard.up('KeyA');
      } else {
        await page.keyboard.down('KeyD');
        await page.waitForTimeout(40);
        await page.keyboard.up('KeyD');
      }
      await page.keyboard.press('KeyJ');
      await page.waitForTimeout(280);
    } else {
      await page.waitForTimeout(100);
    }
  }
  await page.waitForFunction(
    () => {
      const s = window.__SIDEVIEW_DEBUG__?.getState();
      return s?.roomCleared === true || s?.stageCleared === true;
    },
    undefined,
    { timeout: 30000 },
  );
}

/** 等门在输入插件里注册完成再点: setInteractive 是延迟并入 _list 的, 要到下一帧
 * preUpdate 才生效; 人类点不到这 1 帧窗口, 但脚本紧跟入房/清房就点会撞上 (门点击
 * 被静默丢弃)。等 pendingInsertion 清空且 _list 长度等于门数, 即注册已落定。 */
export async function waitForDoorsRegistered(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = window.__SIDEVIEW_DEBUG__?.getState();
      return (
        s !== undefined &&
        s.pendingInsertionSize === 0 &&
        s.inputListSize === s.doors.length
      );
    },
    undefined,
    { timeout: 5000 },
  );
}

/** 游戏坐标 (960x540) 转 canvas 上的点击点。 */
export async function clickGamePoint(page: Page, gx: number, gy: number): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('Canvas bounding box is empty');
  }
  await page.mouse.click(box.x + (gx / 960) * box.width, box.y + (gy / 540) * box.height);
}

/** 点一扇门: 双门时 choice 0 = 左 (740) / 1 = 右 (830); 单门时点 785。 */
export async function clickDoor(page: Page, choice: number): Promise<void> {
  await waitForDoorsRegistered(page);
  const state = await getState(page);
  const gx = state.doors.length === 2 ? (choice === 0 ? 740 : 830) : 785;
  await clickGamePoint(page, gx, 455);
}

/** 在同一 JS 任务里向 canvas 派发两个合成 mousedown (确定性同帧双提交)。 */
export async function dispatchTwoDoorClicks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      throw new Error('no canvas');
    }
    const rect = canvas.getBoundingClientRect();
    for (const [gx, gy] of [
      [740, 455],
      [830, 455],
    ]) {
      canvas.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: rect.left + (gx / 960) * rect.width,
          clientY: rect.top + (gy / 540) * rect.height,
          button: 0,
        }),
      );
    }
  });
}

export async function waitForRoomIndex(page: Page, index: number): Promise<void> {
  await page.waitForFunction(
    (idx) => window.__SIDEVIEW_DEBUG__?.getState().roomIndex === idx,
    index,
    { timeout: 10000 },
  );
}

/** 按住 D 向右走, 直到玩家中心 x >= targetX (8s 上限)。返回 'reached' /
 * 'room-changed'（中途已换房：走路提前触发了别的门）/ 'timeout'。
 * 松开 D 由 finally 保证。调用方按返回值断言，不要只等 roomIndex。 */
export async function walkRightToX(
  page: Page,
  targetX: number,
  roomIndex: number,
): Promise<'reached' | 'room-changed' | 'timeout'> {
  await page.keyboard.down('KeyD');
  try {
    return await page.evaluate(
      async ({ tx, ri }) => {
        const dbg = window.__SIDEVIEW_DEBUG__!;
        for (let i = 0; i < 160; i += 1) {
          const s = dbg.getState();
          if (s.roomIndex !== ri) {
            return 'room-changed' as const;
          }
          if ((s.x ?? 0) >= tx) {
            return 'reached' as const;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        return 'timeout' as const;
      },
      { tx: targetX, ri: roomIndex },
    );
  } finally {
    await page.keyboard.up('KeyD');
  }
}

/** 按 E 确认进门：按住约 100ms 再松开。直接 press（亚帧点按）会被
 * Phaser 的 JustDown 漏掉（keydown 与 keyup 落在同一帧内，update 轮询
 * 前就被 keyup 清掉——仓库里 Space/K 跳跃已有同样教训）。 */
export async function pressDoorConfirm(page: Page): Promise<void> {
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(100);
  await page.keyboard.up('KeyE');
}

/** 按住约 100ms 再松开的通用按键（菜单键 F/Digit/Q/Escape 用）。
 * 实测：直接 press 在商店测试里约 20–40% 丢键——keydown+keyup 落在同一帧
 * 内时连 kb.on 事件驱动的处理器也会漏（F 开店、Digit 购买均丢过），
 * 按住 100ms 后 8/8 通过；真人按键远长于 100ms，不影响游戏本身。 */
export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(100);
  await page.keyboard.up(key);
}

/** 当前房间已清房时, 点一扇门进下一间。若精英房弹出霉运三选一，先选第 1 条再进门。 */
export async function advanceRoom(page: Page, choice = 0): Promise<void> {
  const before = await getState(page);
  if (before.curseMenuOpen) {
    await pressKey(page, 'Digit1');
    await page.waitForFunction(
      () => {
        const s = window.__SIDEVIEW_DEBUG__?.getState();
        return s !== undefined && !s.curseMenuOpen && s.doors.length > 0;
      },
      undefined,
      { timeout: 5000 },
    );
  }
  await clickDoor(page, choice);
  await waitForRoomIndex(page, before.roomIndex + 1);
}

/** 走完全关 (6 间): 分支格按 choiceAtBranch 选; 结束时 stageCleared 为真。 */
export async function clearStage(page: Page, choiceAtBranch = 0): Promise<void> {
  for (let room = 0; room < 6; room += 1) {
    await clearCurrentRoom(page);
    const state = await getState(page);
    if (state.stageCleared) {
      return;
    }
    await advanceRoom(page, room === 1 ? choiceAtBranch : 0);
  }
  await page.waitForFunction(
    () => window.__SIDEVIEW_DEBUG__?.getState().stageCleared === true,
    undefined,
    { timeout: 10000 },
  );
}
