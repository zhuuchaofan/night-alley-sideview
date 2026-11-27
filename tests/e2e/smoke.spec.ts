import { expect, Page, test } from '@playwright/test';
import type { SideviewDebugState } from '../../src/game/sideDebug.ts';

async function waitForCanvasAndDebug(page: Page): Promise<void> {
  await page.waitForSelector('canvas', { state: 'visible' });
  await page.waitForFunction(() => Boolean(window.__SIDEVIEW_DEBUG__));
}

async function getState(page: Page): Promise<SideviewDebugState> {
  return page.evaluate(() => {
    if (!window.__SIDEVIEW_DEBUG__) {
      throw new Error('Missing __SIDEVIEW_DEBUG__');
    }
    return window.__SIDEVIEW_DEBUG__.getState();
  });
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/');
  await waitForCanvasAndDebug(page);
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

async function clearRoom(page: Page): Promise<void> {
  // Kill everything: repeatedly spawn one near the player and slash twice.
  // The 5 initial enemies walk toward the player and get slashed on arrival.
  for (let i = 0; i < 40; i += 1) {
    const state = await getState(page);
    if (state.roomCleared) {
      break;
    }
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.spawnEnemyNearPlayer();
    });
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(320);
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(320);
  }
  await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().roomCleared === true, undefined, {
    timeout: 30000,
  });
}

test.describe('Night Alley Sideview Smoke', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      throw err;
    });
  });

  test('loads canvas, title screen, and serves BGM asset', async ({ page }) => {
    await page.goto('/');
    await waitForCanvasAndDebug(page);

    const box = await page.locator('canvas').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);

    const state = await getState(page);
    expect(state.scene).toBe('TitleScene');

    const bgmRes = await page.request.get('/audio/night-alley-bgm.mp3');
    expect(bgmRes.status()).toBe(200);
  });

  test('moves player right when holding D', async ({ page }) => {
    await startGame(page);
    // BGM must really be playing after the start gesture, not just served.
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().bgmStarted === true, undefined, {
      timeout: 5000,
    });
    const before = await getState(page);
    expect(before.hp).toBe(30);
    expect(before.enemiesAlive).toBe(5);

    await page.keyboard.down('KeyD');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyD');

    const after = await getState(page);
    expect(after.x).toBeGreaterThan(before.x + 40);
  });

  test('spawns enemy near player and kills it with sword swings', async ({ page }) => {
    await startGame(page);

    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.spawnEnemyNearPlayer();
    });

    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(320);
    await page.keyboard.press('KeyJ');

    await page.waitForFunction(
      () => (window.__SIDEVIEW_DEBUG__?.getState().kills ?? 0) >= 1,
      undefined,
      { timeout: 5000 },
    );

    const state = await getState(page);
    expect(state.kills).toBeGreaterThanOrEqual(1);
  });

  test('sword hits show damage numbers, apply hitstop, and kills burst', async ({ page }) => {
    await startGame(page);

    // Slash until a damage number (and its hitstop) registers. Each retry
    // re-spawns a fresh enemy in front of the player, so a retry never
    // repeats the same facing and position after the target walked past.
    for (let i = 0; i < 10; i += 1) {
      const s = await getState(page);
      if (s.damageNumbersShown >= 1) {
        break;
      }
      await page.evaluate(() => {
        window.__SIDEVIEW_DEBUG__?.spawnEnemyNearPlayer();
      });
      await page.keyboard.press('KeyJ');
      await page.waitForTimeout(320);
    }
    const afterHit = await getState(page);
    expect(afterHit.damageNumbersShown).toBeGreaterThanOrEqual(1);
    expect(afterHit.hitstopsApplied).toBeGreaterThanOrEqual(1);

    // Keep slashing until the kill, then the death burst must have fired.
    for (let i = 0; i < 10; i += 1) {
      const s = await getState(page);
      if (s.kills >= 1) {
        break;
      }
      await page.evaluate(() => {
        window.__SIDEVIEW_DEBUG__?.spawnEnemyNearPlayer();
      });
      await page.keyboard.press('KeyJ');
      await page.waitForTimeout(320);
    }
    const afterKill = await getState(page);
    expect(afterKill.kills).toBeGreaterThanOrEqual(1);
    expect(afterKill.burstsSpawned).toBeGreaterThanOrEqual(1);
  });

  test('holding J past the charge threshold releases a heavy strike', async ({ page }) => {
    await startGame(page);

    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.spawnEnemyNearPlayer();
    });

    // One heavy strike deals 12 damage, enough to kill a fresh heart-demon
    // (8 HP) in a single hit; a light swing (6) would leave it alive.
    // 520 ms sits just past the 500 ms threshold, so it also discriminates
    // the old frame-accumulation misread (which under-read the hold).
    await page.keyboard.down('KeyJ');
    await page.waitForTimeout(520);
    await page.keyboard.up('KeyJ');

    await page.waitForFunction(
      () => (window.__SIDEVIEW_DEBUG__?.getState().kills ?? 0) >= 1,
      undefined,
      { timeout: 5000 },
    );

    const state = await getState(page);
    expect(state.kills).toBeGreaterThanOrEqual(1);
  });

  test('roll and dash move the player forward', async ({ page }) => {
    await startGame(page);
    const before = await getState(page);

    // Hold each key across frames: a sub-frame tap can fall between two
    // updates and JustDown never sees it (same as a human tap that fast).
    await page.keyboard.down('Shift');
    await page.waitForTimeout(120);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);
    const afterRoll = await getState(page);
    expect(afterRoll.x).toBeGreaterThan(before.x + 40);

    await page.keyboard.down('KeyL');
    await page.waitForTimeout(120);
    await page.keyboard.up('KeyL');
    await page.waitForTimeout(200);
    const afterDash = await getState(page);
    expect(afterDash.x).toBeGreaterThan(afterRoll.x + 40);
  });

  test('death transitions to GameOverScene', async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.setHp(0);
    });
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().scene === 'GameOverScene');
    const state = await getState(page);
    expect(state.scene).toBe('GameOverScene');
  });

  test('room clear then R restarts the run', async ({ page }) => {
    test.setTimeout(120000);
    await startGame(page);
    await clearRoom(page);

    await page.keyboard.press('KeyR');
    // Wait for post-restart state, not just the scene key: the scene is
    // SideGameScene both before and after the restart, so the key alone
    // cannot tell them apart (kills reset to 0 only on restart).
    await page.waitForFunction(
      () => {
        const s = window.__SIDEVIEW_DEBUG__?.getState();
        return s?.scene === 'SideGameScene' && s.kills === 0 && s.roomCleared === false && s.enemiesAlive === 5;
      },
      undefined,
      { timeout: 10000 },
    );
    const state = await getState(page);
    expect(state.scene).toBe('SideGameScene');
    expect(state.kills).toBe(0);
    expect(state.hp).toBe(30);
    expect(state.enemiesAlive).toBe(5);
  });

  test('room clear then Esc returns to title', async ({ page }) => {
    test.setTimeout(120000);
    await startGame(page);
    await clearRoom(page);

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().scene === 'TitleScene');
    const state = await getState(page);
    expect(state.scene).toBe('TitleScene');
  });
});
