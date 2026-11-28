import { expect, test } from '@playwright/test';
import {
  advanceRoom,
  clearCurrentRoom,
  clickDoor,
  getState,
  pressKey,
  startGame,
} from './helpers.ts';

test.describe('S2 (c): 双形态 + 轻量霉运 + 商店 + 灯油/心魔核', () => {
  test('双形态切换与换形攻击、符纸弹及 S1.5 表现层', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('elite', 270, 500, true);
    });

    const before = await getState(page);
    expect(before.form).toBe('sword');
    expect(before.hudFormText).toBe('形态：剑 [Q]');
    expect(before.enemyInfos?.[0].hp).toBe(36);

    // 按住 J 蓄力时按 Q：取消蓄力、切换为符纸形态、触发 3 伤换形攻击 + 伤害数字 + 顿帧
    await page.keyboard.down('KeyJ');
    await page.waitForTimeout(200);
    // Q 按住 100ms 防丢键，但 J 必须紧跟着 Q 的 keydown 就松开：切到符纸形态后
    // 仍按住 J 会在下一帧立刻自动发一发符纸弹（4 伤），打乱下面的 33 血断言。
    // Q down 与 J up 相隔约 1ms，会进同一帧的输入队列，先切形态、再清 keyJ.isDown，
    // update 时 J 已松开，不会误发符纸。
    await page.keyboard.down('KeyQ');
    await page.keyboard.up('KeyJ');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyQ');
    await page.waitForTimeout(120);

    const afterSwitch = await getState(page);
    expect(afterSwitch.form).toBe('talisman');
    expect(afterSwitch.hudFormText).toBe('形态：符 [Q]');
    expect(afterSwitch.switchCooldown).toBeGreaterThan(0);
    expect(afterSwitch.enemyInfos?.[0].hp).toBe(33);
    expect(afterSwitch.damageNumbersShown).toBeGreaterThan(before.damageNumbersShown);
    expect(afterSwitch.hitstopsApplied).toBeGreaterThan(before.hitstopsApplied);

    // 1.0s 切换冷却期间再按 Q 不生效
    await pressKey(page, 'KeyQ');
    expect((await getState(page)).form).toBe('talisman');

    // 符纸形态按住 J 超过 0.55s 不蓄力，按 0.6s 冷却连发 4 伤符纸弹
    await page.keyboard.down('KeyJ');
    await page.waitForTimeout(800);
    await page.keyboard.up('KeyJ');
    await page.waitForTimeout(150);

    const afterTalisman = await getState(page);
    expect(afterTalisman.enemyInfos?.[0].hp).toBeLessThanOrEqual(29);
    expect(afterTalisman.damageNumbersShown).toBeGreaterThan(afterSwitch.damageNumbersShown);
  });

  test('切换取消疾攻：中途按 Q 后速度归零且疾攻不再命中', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(220, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', 320, 500, true);
    });
    expect((await getState(page)).enemyInfos?.[0].hp).toBe(8);

    // 疾攻（全程 0.18s、520 px/s）：按住 L 约 60ms，确认疾攻已在飞行中再按 Q
    await page.keyboard.down('KeyL');
    await page.waitForTimeout(60);
    const midDash = await getState(page);
    expect(midDash.velocityX).toBeGreaterThan(400);
    await pressKey(page, 'KeyQ');
    await page.keyboard.up('KeyL');

    const afterSwitch = await getState(page);
    expect(afterSwitch.form).toBe('talisman');
    expect(afterSwitch.velocityX).toBe(0);
    await page.waitForTimeout(400);
    const after = await getState(page);
    // 换形攻击 3 伤命中（纸人 8→5）；疾攻 5 伤若漏掉会将其击杀（5−5=0）
    expect(after.enemyInfos?.[0].hp).toBe(5);
    expect(after.enemiesAlive).toBe(1);
    // 玩家停在原地附近，未被疾攻带到 314 附近
    expect(after.x).toBeLessThan(280);
  });

  test('商店开店时点门不换房；钱不够时未购买商品按了无反应', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('shop-1');
      window.__SIDEVIEW_DEBUG__?.setHp(20);
      window.__SIDEVIEW_DEBUG__?.setCoins?.(5);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(200, 478);
    });
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().roomCleared === true,
    );
    expect((await getState(page)).doors).toHaveLength(1);

    // 钱不够：强化 10、买药 8 都买不起（且均未购买过，限购守卫不挡路），按了无反应
    await pressKey(page, 'KeyF');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === true);
    await pressKey(page, 'Digit2');
    await page.waitForTimeout(80);
    let s = await getState(page);
    expect(s.shopMenuOpen).toBe(true);
    expect(s.coins).toBe(5);
    expect(s.shopPurchased).toHaveLength(0);
    await pressKey(page, 'Digit1');
    await page.waitForTimeout(80);
    s = await getState(page);
    expect(s.shopMenuOpen).toBe(true);
    expect(s.coins).toBe(5);
    expect(s.shopPurchased).toHaveLength(0);

    // 够钱后买药成功（对照：余额守卫放行）
    await page.evaluate(() => window.__SIDEVIEW_DEBUG__?.setCoins?.(8));
    await pressKey(page, 'Digit1');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === false);
    s = await getState(page);
    expect(s.coins).toBe(0);
    expect(s.hp).toBe(30);
    expect(s.shopPurchased).toContain('heal');

    // 再开店，点门区不换房：房号、房型、菜单状态、doorUsed 均不变
    await pressKey(page, 'KeyF');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === true);
    const beforeClick = await getState(page);
    await clickDoor(page, 0);
    await page.waitForTimeout(300);
    s = await getState(page);
    expect(s.roomIndex).toBe(beforeClick.roomIndex);
    expect(s.roomType).toBe('shop');
    expect(s.shopMenuOpen).toBe(true);
    expect(s.doorUsed).toBe(false);

    await pressKey(page, 'Escape');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === false);
  });

  test('霉运三选一：红·血契（全局伤+30%，血上限-5且同步扣血最低留1）', async ({ page }) => {
    await startGame(page, 1001);
    for (let i = 0; i < 4; i += 1) {
      await clearCurrentRoom(page);
      await advanceRoom(page, 0);
    }
    expect((await getState(page)).roomType).toBe('elite');
    await clearCurrentRoom(page);

    const menuState = await getState(page);
    expect(menuState.curseMenuOpen).toBe(true);
    expect(menuState.paused).toBe(true);
    expect(menuState.doors).toHaveLength(0);

    await page.evaluate(() => window.__SIDEVIEW_DEBUG__?.setHp(4));
    await pressKey(page, 'Digit1');
    await page.waitForFunction(() => {
      const s = window.__SIDEVIEW_DEBUG__?.getState();
      return s !== undefined && !s.curseMenuOpen && s.doors.length === 1;
    });

    const after = await getState(page);
    expect(after.curse).toBe('blood_pact');
    expect(after.paused).toBe(false);
    expect(after.maxHp).toBe(25);
    expect(after.hp).toBe(1);
    expect(after.swordDamage).toBe(7.8);
    expect(after.talismanDamage).toBe(5.2);
    expect(after.hudCurseText).toContain('血契');
  });

  test('霉运三选一：绿·符蚀（符纸伤+50%冷却-20%，挥剑伤-20%）', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('elite-1');
    });
    await clearCurrentRoom(page);

    expect((await getState(page)).curseMenuOpen).toBe(true);
    await pressKey(page, 'Digit2');
    await page.waitForFunction(() => !window.__SIDEVIEW_DEBUG__?.getState().curseMenuOpen);

    const after = await getState(page);
    expect(after.curse).toBe('talisman_erode');
    expect(after.talismanDamage).toBe(6);
    expect(after.swordDamage).toBe(4.8);
    expect(after.hudCurseText).toContain('符蚀');

    // 验证符纸冷却变为 0.48s（原 0.6s * 0.8）
    await pressKey(page, 'KeyQ');
    await page.keyboard.press('KeyJ');
    const cd = (await getState(page)).talismanCooldown ?? 0;
    expect(cd).toBeLessThanOrEqual(0.48);
    expect(cd).toBeGreaterThan(0.2);
  });

  test('霉运三选一：蓝·聚宝（铜钱掉落+1/只，敌人接触伤害+1）', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('elite-1');
    });
    await clearCurrentRoom(page);

    expect((await getState(page)).curseMenuOpen).toBe(true);
    await pressKey(page, 'Digit3');
    await page.waitForFunction(() => !window.__SIDEVIEW_DEBUG__?.getState().curseMenuOpen);

    const afterCurse = await getState(page);
    expect(afterCurse.curse).toBe('treasure_gather');
    expect(afterCurse.hudCurseText).toContain('聚宝');

    // 进下一间前在调试场测试：清场后放 1 只纸人，击杀应掉 2 枚铜钱；接触应扣 2 血
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('combat-1');
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.setHp(20);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(300, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', 300, 500, true);
    });
    await page.waitForTimeout(150);
    const afterContact = await getState(page);
    expect(afterContact.hp).toBe(18);

    // 瞬移到远处再近身挥剑击杀，验证铜钱掉落数为 2（1 + 1）
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(268, 478);
    });
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(30);
    await page.keyboard.up('KeyD');
    for (let i = 0; i < 4; i += 1) {
      if ((await getState(page)).enemiesAlive === 0) {
        break;
      }
      await page.keyboard.press('KeyJ');
      await page.waitForTimeout(320);
    }

    const afterKill = await getState(page);
    expect(afterKill.enemiesAlive).toBe(0);
    expect((afterKill.coinDropsAlive ?? 0) + afterKill.coins).toBeGreaterThanOrEqual(2);
  });

  test('商店房：F 开店购买三项（限购 1 次）与钱不够置灰无效', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('shop-1');
      window.__SIDEVIEW_DEBUG__?.setHp(15);
      window.__SIDEVIEW_DEBUG__?.setCoins?.(24);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(200, 478);
    });

    // 买药（8 铜钱 -> 回 10 血），买完自动关菜单
    await pressKey(page, 'KeyF');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === true);
    expect((await getState(page)).paused).toBe(true);

    await pressKey(page, 'Digit1');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === false);
    let s = await getState(page);
    expect(s.coins).toBe(16);
    expect(s.hp).toBe(25);
    expect(s.shopPurchased).toContain('heal');

    // 强化（10 铜钱 -> 挥剑 +2）
    await pressKey(page, 'KeyF');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === true);
    await pressKey(page, 'Digit2');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === false);
    s = await getState(page);
    expect(s.coins).toBe(6);
    expect(s.swordDamage).toBe(8);

    // 符纸（6 铜钱 -> 符纸 +2）
    await pressKey(page, 'KeyF');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === true);
    await pressKey(page, 'Digit3');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === false);
    s = await getState(page);
    expect(s.coins).toBe(0);
    expect(s.talismanDamage).toBe(6);

    // 给 10 铜钱但买药已买过（限购 1 次），按 1 无反应；再设 3 铜钱（钱不够）按 1/2/3 也无反应
    await page.evaluate(() => window.__SIDEVIEW_DEBUG__?.setCoins?.(10));
    await pressKey(page, 'KeyF');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === true);
    await pressKey(page, 'Digit1');
    await page.waitForTimeout(80);
    s = await getState(page);
    expect(s.shopMenuOpen).toBe(true);
    expect(s.coins).toBe(10);

    await page.evaluate(() => window.__SIDEVIEW_DEBUG__?.setCoins?.(3));
    await pressKey(page, 'KeyF'); // close
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === false);
    await page.waitForTimeout(40);
    await pressKey(page, 'KeyF'); // reopen with 3 coins
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === true);
    await pressKey(page, 'Digit1');
    await pressKey(page, 'Digit2');
    await pressKey(page, 'Digit3');
    await page.waitForTimeout(80);
    s = await getState(page);
    expect(s.shopMenuOpen).toBe(true);
    expect(s.coins).toBe(3);

    await pressKey(page, 'Escape');
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().shopMenuOpen === false);
  });

  test('灯油与心魔核拾取及 HUD 同步（精英掉 1 油，Boss 掉 2 油 1 核）', async ({ page }) => {
    await startGame(page, 1001);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('elite-1');
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('elite', 400, 500, true);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(368, 478);
    });

    // 击杀精英：掉 1 灯油
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(30);
    await page.keyboard.up('KeyD');
    for (let i = 0; i < 10; i += 1) {
      const cur = await getState(page);
      if (cur.enemiesAlive === 0) {
        break;
      }
      await page.keyboard.press('KeyJ');
      await page.waitForTimeout(320);
    }
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().curseMenuOpen === true);
    await pressKey(page, 'Digit1'); // 选霉运关闭菜单
    await page.waitForFunction(() => window.__SIDEVIEW_DEBUG__?.getState().curseMenuOpen === false);

    // 走近拾取灯油
    await page.evaluate(() => window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(400, 478));
    await page.waitForTimeout(100);
    const afterElite = await getState(page);
    expect(afterElite.lampOil).toBe(1);
    expect(afterElite.demonCore).toBe(0);
    expect(afterElite.hudPickupsText).toBe('油：1 核：0');

    // 进 Boss 房（第 6 间）测试 Boss 掉 2 油 1 核
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('boss-1');
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('boss', 500, 500, true);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(468, 478);
    });
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(30);
    await page.keyboard.up('KeyD');
    // 连续重击/挥剑击杀 Boss
    for (let i = 0; i < 14; i += 1) {
      if ((await getState(page)).enemiesAlive === 0) {
        break;
      }
      await page.keyboard.down('KeyJ');
      await page.waitForTimeout(540);
      await page.keyboard.up('KeyJ');
      await page.waitForTimeout(120);
    }
    expect((await getState(page)).enemiesAlive).toBe(0);

    // 走近 Boss 掉落点拾取 2 油 + 1 核
    for (const x of [480, 500, 520]) {
      await page.evaluate((tx) => window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(tx, 478), x);
      await page.waitForTimeout(80);
    }
    const afterBoss = await getState(page);
    expect(afterBoss.lampOil).toBe(3);
    expect(afterBoss.demonCore).toBe(1);
    expect(afterBoss.hudPickupsText).toBe('油：3 核：1');
  });
});
