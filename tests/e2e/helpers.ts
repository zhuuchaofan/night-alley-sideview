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

/** 杀光当前房间的敌人 (反复在玩家附近生成一只、挥剑两次)。零敌人房直接返回。
 * 每轮先回满血: 五间连清时站桩的玩家会被围殴致死, 回血只保 helper 走完流程。 */
export async function clearCurrentRoom(page: Page): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const state = await getState(page);
    if (state.roomCleared || state.stageCleared) {
      return;
    }
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.setHp(30);
    });
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.spawnEnemyNearPlayer();
    });
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(320);
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(320);
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

/** 当前房间已清房时, 点一扇门进下一间。 */
export async function advanceRoom(page: Page, choice = 0): Promise<void> {
  const before = await getState(page);
  await clickDoor(page, choice);
  await waitForRoomIndex(page, before.roomIndex + 1);
}

/** 走完全关 (5 间): 分支格按 choiceAtBranch 选; 结束时 stageCleared 为真。 */
export async function clearStage(page: Page, choiceAtBranch = 0): Promise<void> {
  for (let room = 0; room < 5; room += 1) {
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
