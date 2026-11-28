import { expect, test, type Page } from '@playwright/test';
import { generateStage } from '../../src/game/rooms.ts';
import {
  advanceRoom,
  clearCurrentRoom,
  getState,
  startGame,
  waitForRoomIndex,
} from './helpers.ts';

const TOUCH_SEED = 20261127;

/** 游戏坐标 (960x540) 转视口坐标, 用触屏点按。 */
async function tapGamePoint(page: Page, gx: number, gy: number): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('Canvas bounding box is empty');
  }
  await page.touchscreen.tap(
    box.x + (gx / 960) * box.width,
    box.y + (gy / 540) * box.height,
  );
}

/** 用 CDP 发一串触摸事件做摇杆拖动: 落指后分步移到目标点, 按住 holdMs 再松开。
 * 返回按住期间读到的状态 (松开前)。 */
async function dragJoystick(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  holdMs: number,
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y: fromY, id: 1 }],
  });
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: fromX + ((toX - fromX) * i) / steps, y: fromY, id: 1 }],
    });
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(holdMs);
  const mid = await getState(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  return mid;
}

/** 摇杆落指点: 画布左半边内, 底部附近 (左 100px, 底上 90px)。 */
async function stickPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) {
    throw new Error('Canvas bounding box is empty');
  }
  return { x: box.x + 100, y: box.y + box.height - 90 };
}

test('桌面浏览器不出现触屏 UI', async ({ page }) => {
  await startGame(page, 1001);
  await expect(page.locator('#touch-overlay')).toHaveCount(0);
  expect((await getState(page)).touchOverlayEnabled).toBe(false);
});

test.describe('S2 (d): 触屏操作', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test('触屏设备进游戏后覆盖层出现', async ({ page }) => {
    await startGame(page, 1001);
    await expect(page.locator('#touch-overlay')).toBeVisible();
    expect((await getState(page)).touchOverlayEnabled).toBe(true);
    for (const id of ['#touch-btn-jump', '#touch-btn-attack', '#touch-btn-roll', '#touch-btn-dash', '#touch-btn-switch']) {
      await expect(page.locator(id)).toBeVisible();
    }
    // 不在柜台旁时开店按钮隐藏
    await expect(page.locator('#touch-btn-shop')).toBeHidden();
  });

  test('摇杆向右/向左拖动移动, 松手即停', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
    });
    const pt = await stickPoint(page);

    const midRight = await dragJoystick(page, pt.x, pt.y, pt.x + 40, 500);
    expect(midRight.x).toBeGreaterThan(250);
    // 松手后应停住: 两次相隔 300ms 的读数几乎不动 (CDP 投递本身占几帧,
    // 故不断言松手瞬间零位移, 只断言停稳后不再漂移)。
    await page.waitForTimeout(300);
    const stopped1 = await getState(page);
    await page.waitForTimeout(300);
    const stopped2 = await getState(page);
    expect(Math.abs(stopped2.x - stopped1.x)).toBeLessThanOrEqual(2);

    await page.evaluate(() => window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478));
    const midLeft = await dragJoystick(page, pt.x, pt.y, pt.x - 40, 500);
    expect(midLeft.x).toBeLessThan(190);
  });

  test('跳按钮离地', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
    });
    // 传送后须等一个物理步, blocked.down 才会登记着地 (刚 reset 时为旧值)。
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().grounded === true,
      undefined,
      { timeout: 5000 },
    );
    expect((await getState(page)).grounded).toBe(true);
    await page.locator('#touch-btn-jump').tap();
    await page.waitForFunction(
      () => {
        const s = window.__SIDEVIEW_DEBUG__?.getState();
        return s !== undefined && (!s.grounded || (s.y ?? 500) < 470);
      },
      undefined,
      { timeout: 2000 },
    );
  });

  test('攻击按钮挥剑命中、翻滚、疾攻位移', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('elite', 270, 500, true);
    });
    const before = await getState(page);
    expect(before.enemyInfos?.[0].hp).toBe(36);

    await page.locator('#touch-btn-attack').tap();
    await page.waitForTimeout(300);
    const afterAttack = await getState(page);
    expect(afterAttack.enemyInfos?.[0].hp).toBeLessThan(36);
    expect(afterAttack.damageNumbersShown).toBeGreaterThan(before.damageNumbersShown);

    // 翻滚: 0.3s 内 rolling 应为真
    await page.locator('#touch-btn-roll').tap();
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().rolling === true,
      undefined,
      { timeout: 1000 },
    );

    // 疾攻: 0.18s、520px/s, 约 94px 位移
    await page.waitForTimeout(500);
    const beforeDash = await getState(page);
    await page.locator('#touch-btn-dash').tap();
    await page.waitForTimeout(400);
    const afterDash = await getState(page);
    expect(afterDash.x).toBeGreaterThan(beforeDash.x + 40);
  });

  test('切换按钮切形态, 符纸形态攻击发符纸弹', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('elite', 270, 500, true);
    });
    expect((await getState(page)).form).toBe('sword');

    await page.locator('#touch-btn-switch').tap();
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().form === 'talisman',
      undefined,
      { timeout: 2000 },
    );
    expect((await getState(page)).hudFormText).toBe('形态：符 [Q]');

    const before = await getState(page);
    await page.locator('#touch-btn-attack').tap();
    await page.waitForTimeout(300);
    const after = await getState(page);
    expect(after.enemyInfos?.[0].hp).toBeLessThan(before.enemyInfos?.[0].hp ?? 36);
    expect(after.damageNumbersShown).toBeGreaterThan(before.damageNumbersShown);
  });

  test('靠近柜台出现开店按钮, 点开店后点卡购买', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('shop-1');
      window.__SIDEVIEW_DEBUG__?.setHp(15);
      window.__SIDEVIEW_DEBUG__?.setCoins?.(24);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(200, 478);
    });
    await expect(page.locator('#touch-btn-shop')).toBeVisible();
    await page.locator('#touch-btn-shop').tap();
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === true,
      undefined,
      { timeout: 5000 },
    );
    // 菜单打开时覆盖层隐藏, 不吃菜单卡片的点击
    await expect(page.locator('#touch-overlay')).toBeHidden();
    expect((await getState(page)).touchOverlayEnabled).toBe(false);

    // 点第 1 张卡 (买药 8 铜钱 → 回 10 血), 买完菜单关闭、覆盖层恢复
    await tapGamePoint(page, 252, 270);
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === false,
      undefined,
      { timeout: 5000 },
    );
    const after = await getState(page);
    expect(after.coins).toBe(16);
    expect(after.hp).toBe(25);
    expect(after.shopPurchased).toContain('heal');
    await expect(page.locator('#touch-overlay')).toBeVisible();
    expect(after.touchOverlayEnabled).toBe(true);
  });

  test('精英房清房后点卡选霉运, 覆盖层先藏后现', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('elite-1');
    });
    await clearCurrentRoom(page);
    expect((await getState(page)).curseMenuOpen).toBe(true);
    await expect(page.locator('#touch-overlay')).toBeHidden();

    await tapGamePoint(page, 252, 270);
    await page.waitForFunction(
      () => {
        const s = window.__SIDEVIEW_DEBUG__?.getState();
        return s !== undefined && !s.curseMenuOpen && s.doors.length > 0;
      },
      undefined,
      { timeout: 5000 },
    );
    const after = await getState(page);
    expect(after.curse).toBe('blood_pact');
    await expect(page.locator('#touch-overlay')).toBeVisible();
  });

  test('触屏点门进房', async ({ page }) => {
    await startGame(page, 1001);
    await clearCurrentRoom(page);
    const before = await getState(page);
    expect(before.doors.length).toBeGreaterThan(0);
    const gx = before.doors.length === 2 ? 740 : 785;
    await tapGamePoint(page, gx, 455);
    await waitForRoomIndex(page, before.roomIndex + 1);
    expect((await getState(page)).roomIndex).toBe(before.roomIndex + 1);
  });

  test('触屏点右门进右候选房 (与左门不同模板)', async ({ page }) => {
    test.setTimeout(120000);
    // 与 stage.spec.ts 的双门测试同一种子: 分支格预抽一战斗一宝箱两个候选,
    // 左门进候选 0、右门进候选 1; 触屏点右门必须提交 choice 1, 不能错进左门。
    const chain = generateStage(TOUCH_SEED);
    const branch = chain.slots[2];
    expect(branch.slot.kind).toBe('choice');
    expect(branch.candidates).toHaveLength(2);

    // 左门 (choice 0) -> 候选 0。
    await startGame(page, TOUCH_SEED);
    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    let state = await getState(page);
    expect(state.doors).toHaveLength(2);
    await tapGamePoint(page, 740, 455);
    await waitForRoomIndex(page, 2);
    state = await getState(page);
    expect(state.roomTemplateId).toBe(branch.candidates[0].id);

    // 同种子重开: 右门 (choice 1) -> 候选 1。
    await startGame(page, TOUCH_SEED);
    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    state = await getState(page);
    expect(state.doors).toHaveLength(2);
    await tapGamePoint(page, 830, 455);
    await waitForRoomIndex(page, 2);
    state = await getState(page);
    expect(state.roomType).toBe('chest');
    expect(state.roomTemplateId).toBe(branch.candidates[1].id);
  });

  test('触屏按住攻击蓄力重击', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('elite', 270, 500, true);
    });
    const before = await getState(page);
    expect(before.enemyInfos?.[0].hp).toBe(36);
    // 按住攻击按钮 650ms (蓄力阈值 500ms), 松开应打出重击 12 伤。
    await page.locator('#touch-btn-attack').dispatchEvent('pointerdown');
    await page.waitForTimeout(650);
    await page.locator('#touch-btn-attack').dispatchEvent('pointerup');
    await page.waitForTimeout(300);
    const after = await getState(page);
    expect(after.enemyInfos?.[0].hp).toBe(24);
    expect(after.heavyShakesApplied).toBeGreaterThan(before.heavyShakesApplied);
  });

  test('键盘 J 蓄力时触屏轻点攻击不提前结算 (Codex r1 B1)', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('elite', 270, 500, true);
    });
    expect((await getState(page)).enemyInfos?.[0].hp).toBe(36);
    await page.keyboard.down('KeyJ');
    await page.waitForTimeout(200);
    // 触屏轻点一轮按-松: 蓄力须继续, 精英不满血才算提前结算。
    await page.locator('#touch-btn-attack').tap();
    await page.waitForTimeout(200);
    expect((await getState(page)).enemyInfos?.[0].hp).toBe(36);
    await page.keyboard.up('KeyJ');
    await page.waitForTimeout(300);
    expect((await getState(page)).enemyInfos?.[0].hp).toBeLessThan(36);
  });

  test('攻击按钮只接受持有指针的松手 (Codex r1 B2)', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('elite', 270, 500, true);
    });
    expect((await getState(page)).enemyInfos?.[0].hp).toBe(36);
    await page.locator('#touch-btn-attack').dispatchEvent('pointerdown', { pointerId: 1 });
    await page.waitForTimeout(200);
    // 另一指抬起: 须被忽略, 蓄力继续。
    await page.locator('#touch-btn-attack').dispatchEvent('pointerup', { pointerId: 2 });
    await page.waitForTimeout(200);
    expect((await getState(page)).enemyInfos?.[0].hp).toBe(36);
    await page.locator('#touch-btn-attack').dispatchEvent('pointerup', { pointerId: 1 });
    await page.waitForTimeout(300);
    expect((await getState(page)).enemyInfos?.[0].hp).toBeLessThan(36);
  });

  test('攻击按钮被系统取消时不结算挥剑 (Codex r1 B2)', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('elite', 270, 500, true);
    });
    expect((await getState(page)).enemyInfos?.[0].hp).toBe(36);
    await page.locator('#touch-btn-attack').dispatchEvent('pointerdown', { pointerId: 1 });
    await page.waitForTimeout(200);
    await page.locator('#touch-btn-attack').dispatchEvent('pointercancel', { pointerId: 1 });
    await page.waitForTimeout(300);
    // 取消只清状态不挥剑: 精英仍满血。
    expect((await getState(page)).enemyInfos?.[0].hp).toBe(36);
    // 取消后按钮仍可用: 再点按一次应正常命中。
    await page.locator('#touch-btn-attack').tap();
    await page.waitForTimeout(300);
    expect((await getState(page)).enemyInfos?.[0].hp).toBeLessThan(36);
  });

  test('翻滚期间按跳, 动作结束才起跳 (Codex r1 B3)', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
    });
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().grounded === true,
      undefined,
      { timeout: 5000 },
    );
    await page.keyboard.down('Shift');
    await page.waitForTimeout(100);
    // 翻滚中 (0.3s) 按下跳并一直按住: 边沿须保留到翻滚结束, 不能被提前消费。
    // 注意: JustDown 的边沿在松开按键时也会清掉 (Key.onUp), 所以 K 必须按住
    // 直到翻滚结束, 提前松开是测不到缓冲的 (原版行为同样要求按住)。
    await page.keyboard.down('KeyK');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyK');
    await page.keyboard.up('Shift');
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().grounded === false,
      undefined,
      { timeout: 1500 },
    );
  });

  test('advanceRoom 回归：鼠标点门推进一间', async ({ page }) => {
    await startGame(page, 1001);
    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    expect((await getState(page)).roomIndex).toBe(1);
  });
});

test.describe('S2 (d): 触屏窄视口', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('竖屏窄视口下按钮不侵入摇杆区 (Codex r1 S2)', async ({ page }) => {
    await startGame(page, 1001);
    const zone = await page.locator('#touch-stick-zone').boundingBox();
    const btn = await page.locator('#touch-btn-switch').boundingBox();
    expect(zone).not.toBeNull();
    expect(btn).not.toBeNull();
    expect(btn!.x).toBeGreaterThanOrEqual(zone!.x + zone!.width);
  });
});
