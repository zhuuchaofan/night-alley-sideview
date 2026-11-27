import { expect, test } from '@playwright/test';
import { advanceRoom, clearCurrentRoom, getState, startGame } from './helpers.ts';

test.describe('Night Alley S2 Slice (b): Contact, Separation & 6 Enemy Kinds', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      throw err;
    });
  });

  test('B1: all enemy kinds (including elite and boss) keep 28x46 body even during contact flash', async ({
    page,
  }) => {
    await startGame(page, 1000);
    for (const kind of ['paper', 'elite', 'boss'] as const) {
      await page.evaluate((k) => {
        window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
        window.__SIDEVIEW_DEBUG__?.setHp(30);
        window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(300, 478);
        window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.(k, 324, 500, true);
      }, kind);
      const init = await getState(page);
      const e0 = init.enemyInfos?.[0];
      expect(e0).toBeDefined();
      expect(e0!.bodyRight - e0!.bodyLeft).toBe(28);
      expect(e0!.bodyBottom - e0!.bodyTop).toBe(46);

      // Wait for contact hit flash (attackFlash === true) and verify body size stays 28x46.
      await page.waitForFunction(
        () => window.__SIDEVIEW_DEBUG__?.getState().enemyInfos?.[0]?.attackFlash === true,
        undefined,
        { timeout: 1000 },
      );
      const flashing = await getState(page);
      const eFlash = flashing.enemyInfos?.[0];
      expect(eFlash).toBeDefined();
      expect(eFlash!.bodyRight - eFlash!.bodyLeft).toBe(28);
      expect(eFlash!.bodyBottom - eFlash!.bodyTop).toBe(46);
    }
  });

  test('B2: contact damage requires strict overlap, respects 1.75s cooldown and roll i-frames', async ({
    page,
  }) => {
    test.setTimeout(30000);
    await startGame(page, 1001);

    // 1. Verify body dimensions from debug hook (player 28x48, enemy 28x46) and 4px gap (3s no damage).
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(300, 478);
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const pb = window.__SIDEVIEW_DEBUG__!.getState().playerBody!;
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', pb.right + 14 + 4, 500, true);
    });
    const gapInit = await getState(page);
    expect(gapInit.playerBody!.right - gapInit.playerBody!.left).toBe(28);
    expect(gapInit.playerBody!.bottom - gapInit.playerBody!.top).toBe(48);
    expect(gapInit.enemyInfos![0].bodyRight - gapInit.enemyInfos![0].bodyLeft).toBe(28);
    expect(gapInit.enemyInfos![0].bodyBottom - gapInit.enemyInfos![0].bodyTop).toBe(46);
    expect(gapInit.enemyInfos![0].bodyLeft - gapInit.playerBody!.right).toBe(4);

    await page.waitForTimeout(3000);
    expect((await getState(page)).hp).toBe(30);

    // 2. Touching edge (0px overlap: enemy bodyLeft === playerBody.right): no damage.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      const pb = window.__SIDEVIEW_DEBUG__!.getState().playerBody!;
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', pb.right + 14, 500, true);
    });
    const edgeInit = await getState(page);
    expect(edgeInit.enemyInfos![0].bodyLeft).toBe(edgeInit.playerBody!.right);
    await page.waitForTimeout(500);
    expect((await getState(page)).hp).toBe(30);

    // 3. 4px overlap: the same enemy's 2nd hit lands exactly 1.75s after the
    // 1st (scene clock, one update step ≈ 16ms tolerance).
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      const pb = window.__SIDEVIEW_DEBUG__!.getState().playerBody!;
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', pb.right + 14 - 4, 500, true);
    });
    const overlapEnemy = (await getState(page)).enemyInfos![0];
    const overlapId = overlapEnemy.id;
    await page.waitForFunction(
      (id) =>
        (window.__SIDEVIEW_DEBUG__?.getState().contactSignals ?? []).filter(
          (s) => s.enemyId === id,
        ).length >= 2,
      overlapId,
      { timeout: 5000 },
    );
    const afterSecondHit = await getState(page);
    expect(afterSecondHit.hp).toBe(28);
    const hits = (afterSecondHit.contactSignals ?? []).filter((s) => s.enemyId === overlapId);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const cooldownMs = hits[1].timeMs - hits[0].timeMs;
    expect(cooldownMs).toBeGreaterThanOrEqual(1750 - 16);
    // 上限放两帧 (33ms): 实测单帧可达 17ms, 1750+16 会把真 1.75s 误判;
    // 1.5s 反例落在 1500–1517ms, 仍被下限 1734 挡住。
    expect(cooldownMs).toBeLessThanOrEqual(1750 + 33);

    // 4. Roll i-frames: while rolling, the player strictly overlaps the enemy
    // yet takes no damage. All three facts are sampled together each frame,
    // so a roll that never reaches the enemy (or never triggers) cannot pass.
    // facing 恒为 1 (本用例全程无方向键, resetState 默认朝右), 翻滚向右撞向敌人。
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.setHp(30);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(260, 478);
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const pb = window.__SIDEVIEW_DEBUG__!.getState().playerBody!;
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', pb.right + 14 + 16, 500, true);
    });
    await page.keyboard.down('Shift');
    let sawRolling = false;
    let sawRollOverlap = false;
    const rollStart = Date.now();
    while (Date.now() - rollStart < 450) {
      const s = await getState(page);
      if (s.rolling) {
        sawRolling = true;
        // No damage may land on any rolling frame.
        expect(s.hp).toBe(30);
        const e = s.enemyInfos?.[0];
        if (
          e &&
          s.playerBody!.left < e.bodyRight &&
          e.bodyLeft < s.playerBody!.right &&
          s.playerBody!.top < e.bodyBottom &&
          e.bodyTop < s.playerBody!.bottom
        ) {
          sawRollOverlap = true;
        }
      }
      await page.waitForTimeout(15);
    }
    await page.keyboard.up('Shift');
    expect(sawRolling).toBe(true);
    expect(sawRollOverlap).toBe(true);
    expect((await getState(page)).hp).toBe(30);
  });

  test('B3: 5 enemies surrounding player for 5s stay separated and every HP drop matches a signal within 0.5s', async ({
    page,
  }) => {
    test.setTimeout(30000);
    await startGame(page, 1002);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.setHp(30);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(480, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', 380, 500, false);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('lantern', 420, 500, false);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('swift', 530, 500, false);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', 570, 500, false);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('lantern', 610, 500, false);
    });

    const samples: {
      t: number;
      hp: number;
      infos: NonNullable<Awaited<ReturnType<typeof getState>>['enemyInfos']>;
      signals: NonNullable<Awaited<ReturnType<typeof getState>>['contactSignals']>;
    }[] = [];

    const startMs = Date.now();
    let prevHp = 30;
    let consecutiveOverlapCount = 0;
    let maxConsecutiveOverlaps = 0;
    // 已配对的信号 (enemyId:timeMs), 每条信号只用一次。
    const consumedSignals = new Set<string>();
    // 已见过的、属于本局 5 只怪的信号 (用于末尾核对无孤儿信号)。
    const seenPlacedSignals = new Set<string>();
    let totalDrops = 0;
    let placedIds: number[] = [];

    while (Date.now() - startMs < 5000) {
      const s = await getState(page);
      const infos = s.enemyInfos ?? [];
      const signals = s.contactSignals ?? [];
      samples.push({ t: Date.now() - startMs, hp: s.hp, infos, signals });
      if (placedIds.length === 0) {
        placedIds = infos.map((e) => e.id);
      }
      for (const sig of signals) {
        if (placedIds.includes(sig.enemyId)) {
          seenPlacedSignals.add(`${sig.enemyId}:${sig.timeMs}`);
        }
      }

      let anyOverlapThisSample = false;
      // 未取整盒边 + 实际半宽之和: 两盒在 X 与 Y 上都严格相交才算重叠。
      // EPS 只是浮点护栏 (分离后盒边恰好相接 28.0px 时的亚像素抖动不算重叠)。
      const EPS = 0.01;
      for (let i = 0; i < infos.length; i += 1) {
        for (let j = i + 1; j < infos.length; j += 1) {
          const halfSum =
            (infos[i].bodyRightRaw - infos[i].bodyLeftRaw +
              (infos[j].bodyRightRaw - infos[j].bodyLeftRaw)) *
            0.5;
          const cxA = (infos[i].bodyLeftRaw + infos[i].bodyRightRaw) * 0.5;
          const cxB = (infos[j].bodyLeftRaw + infos[j].bodyRightRaw) * 0.5;
          const overlapX = Math.abs(cxA - cxB) < halfSum - EPS;
          const overlapY =
            infos[i].bodyTopRaw < infos[j].bodyBottomRaw - EPS &&
            infos[j].bodyTopRaw < infos[i].bodyBottomRaw - EPS;
          if (overlapX && overlapY) {
            anyOverlapThisSample = true;
          }
        }
      }
      if (anyOverlapThisSample) {
        consecutiveOverlapCount += 1;
        maxConsecutiveOverlaps = Math.max(maxConsecutiveOverlaps, consecutiveOverlapCount);
      } else {
        consecutiveOverlapCount = 0;
      }

      if (s.hp < prevHp) {
        const drops = prevHp - s.hp;
        totalDrops += drops;
        // 每次 1 HP 扣减都要配对一条未消费的信号 (同一场景时钟, ≤500ms)。
        for (let d = 0; d < drops; d += 1) {
          const match = signals.find(
            (sig) =>
              !consumedSignals.has(`${sig.enemyId}:${sig.timeMs}`) &&
              infos.some((e) => e.id === sig.enemyId) &&
              sig.timeMs <= s.timeNow &&
              s.timeNow - sig.timeMs <= 500,
          );
          expect(match).toBeDefined();
          consumedSignals.add(`${match!.enemyId}:${match!.timeMs}`);
        }
        prevHp = s.hp;
      }
      await page.waitForTimeout(50);
    }

    expect(samples.length).toBeGreaterThan(30);
    expect(maxConsecutiveOverlaps).toBeLessThanOrEqual(1);
    // Verify at least one damage event occurred; every placed-enemy signal was
    // consumed exactly once for a matching HP drop (no orphan or reused signal).
    expect(prevHp).toBeLessThan(30);
    expect(totalDrops).toBe(30 - prevHp);
    expect(seenPlacedSignals.size).toBe(totalDrops);
  });

  test('B3a: movable enemy wedged between wall and pinned enemy crosses to the free side', async ({
    page,
  }) => {
    test.setTimeout(30000);
    await startGame(page, 1004);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.setHp(30);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(800, 478);
      // 冻结怪贴左墙 (sprite.x 100), 可移动怪夹在墙与它之间 (88)。
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', 100, 500, true);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', 88, 500, false);
    });
    // 可移动怪向玩家走 (向右), 单侧推离被左墙截断; 修好后应越过冻结怪到右侧。
    await page.waitForTimeout(1000);
    let overlapped = false;
    for (let i = 0; i < 6; i += 1) {
      const s = await getState(page);
      const infos = s.enemyInfos ?? [];
      if (infos.length >= 2) {
        const [a, b] = infos;
        const EPS = 0.01;
        const overlapX =
          a.bodyLeftRaw < b.bodyRightRaw - EPS && b.bodyLeftRaw < a.bodyRightRaw - EPS;
        const overlapY =
          a.bodyTopRaw < b.bodyBottomRaw - EPS && b.bodyTopRaw < a.bodyBottomRaw - EPS;
        if (overlapX && overlapY) {
          overlapped = true;
        }
      }
      await page.waitForTimeout(50);
    }
    expect(overlapped).toBe(false);
    // 冻结怪保持原位 (infos[0] 为先放置的冻结怪)。
    const final = await getState(page);
    expect(final.enemyInfos?.[0]?.x).toBe(100);
  });

  test('S1 & S2: swift lunge, shooter 3 zones, elite 3 coins + S1.5 heavy feel, boss phase 2', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await startGame(page, 1003);

    // 1. Swift (2 HP): 1 light swing kills it; also lunges toward player when in range.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(300, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('swift', 440, 500, false);
    });
    const swiftInit = await getState(page);
    expect(swiftInit.enemyInfos?.[0].hp).toBe(2);
    await page.waitForTimeout(1600);
    const swiftMoved = await getState(page);
    expect(swiftMoved.enemyInfos?.[0].x ?? 440).toBeLessThan(400);

    // 1b. Swift lunge: after a 0.25s windup it lunges at 2.2x walk speed
    // (181.5px/s vs 82.5px/s): ~36px in 200ms, not ~16px of plain walking.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(300, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('swift', 440, 500, false);
    });
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().enemyInfos?.[0]?.windup === true,
      undefined,
      { timeout: 5000 },
    );
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().enemyInfos?.[0]?.windup === false,
      undefined,
      { timeout: 1000 },
    );
    const lungeX1 = (await getState(page)).enemyInfos![0].x;
    await page.waitForTimeout(200);
    const lungeX2 = (await getState(page)).enemyInfos![0].x;
    expect(lungeX1 - lungeX2).toBeGreaterThanOrEqual(20);

    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(300, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('swift', 332, 500, true);
    });
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(40);
    await page.keyboard.up('KeyD');
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(200);
    let s = await getState(page);
    expect(s.enemiesAlive).toBe(0);

    // 2. Shooter: far (>200) approaches, mid (120..200) holds, close (<120) retreats, and fires periodically.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(150, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('shooter', 560, 500, false);
    });
    await page.waitForTimeout(500);
    const shooterFar = await getState(page);
    expect(shooterFar.enemyInfos![0].x).toBeLessThan(560);

    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(200, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('shooter', 360, 500, false);
    });
    await page.waitForTimeout(300);
    const shooterMid = await getState(page);
    expect(Math.abs(shooterMid.enemyInfos![0].x - 360)).toBeLessThanOrEqual(4);

    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(300, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('shooter', 370, 500, false);
    });
    await page.waitForTimeout(450);
    const shooterClose = await getState(page);
    expect(shooterClose.enemyInfos![0].x).toBeGreaterThan(370);
    await page.waitForFunction(
      () => (window.__SIDEVIEW_DEBUG__?.getState().enemyBoltsAlive ?? 0) >= 1,
      undefined,
      { timeout: 6000 },
    );

    // 2b. Shooter fires every 3.0s: two consecutive volleys 3s apart.
    // First bolt flies right (player at 600); teleport the player away so the
    // bolt stays alive (4.5s life, exits at the right wall) until volley 2.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(600, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('shooter', 400, 500, false);
    });
    await page.waitForFunction(
      () => (window.__SIDEVIEW_DEBUG__?.getState().enemyBoltsAlive ?? 0) >= 1,
      undefined,
      { timeout: 6000 },
    );
    const volleyT1 = Date.now();
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(120, 478);
    });
    await page.waitForFunction(
      () => (window.__SIDEVIEW_DEBUG__?.getState().enemyBoltsAlive ?? 0) >= 2,
      undefined,
      { timeout: 6000 },
    );
    const volleyT2 = Date.now();
    expect(volleyT2 - volleyT1).toBeGreaterThanOrEqual(2500);
    expect(volleyT2 - volleyT1).toBeLessThanOrEqual(3500);

    // 3. Elite (36 HP): S1.5 heavy hit (hold KeyJ 520ms = 12 dmg) triggers hitstop, hitFlash, knockX, stable 28x46 body, and drops exactly 3 coins.
    const coinsBefore = (await getState(page)).coins;
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(300, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('elite', 332, 500, true);
    });
    const eliteStart = await getState(page);
    expect(eliteStart.enemyInfos?.[0].hp).toBe(36);
    const hitstopsBefore = eliteStart.hitstopsApplied;
    const heavyShakesBefore = eliteStart.heavyShakesApplied;

    await page.keyboard.down('KeyJ');
    await page.waitForTimeout(520);
    await page.keyboard.up('KeyJ');
    await page.waitForTimeout(30);
    const eliteAfterHeavy = await getState(page);
    expect(eliteAfterHeavy.hitstopsApplied).toBeGreaterThan(hitstopsBefore);
    expect(eliteAfterHeavy.heavyShakesApplied).toBeGreaterThan(heavyShakesBefore);
    expect(eliteAfterHeavy.enemyInfos?.[0].hp).toBe(24);
    expect(eliteAfterHeavy.enemyInfos?.[0].hitFlash).toBe(true);
    expect(eliteAfterHeavy.enemyInfos?.[0].knockX).not.toBe(0);
    expect(eliteAfterHeavy.enemyInfos![0].bodyRight - eliteAfterHeavy.enemyInfos![0].bodyLeft).toBe(28);
    expect(eliteAfterHeavy.enemyInfos![0].bodyBottom - eliteAfterHeavy.enemyInfos![0].bodyTop).toBe(46);
    // 冻结精英的物理盒四边位置命中前后完全不动 (不只是尺寸)。
    expect(eliteAfterHeavy.enemyInfos![0].bodyLeft).toBe(eliteStart.enemyInfos![0].bodyLeft);
    expect(eliteAfterHeavy.enemyInfos![0].bodyRight).toBe(eliteStart.enemyInfos![0].bodyRight);
    expect(eliteAfterHeavy.enemyInfos![0].bodyTop).toBe(eliteStart.enemyInfos![0].bodyTop);
    expect(eliteAfterHeavy.enemyInfos![0].bodyBottom).toBe(eliteStart.enemyInfos![0].bodyBottom);

    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(350);
      await page.keyboard.press('KeyJ');
      const cur = await getState(page);
      if (cur.enemiesAlive === 0) {
        break;
      }
    }
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(450);
    await page.keyboard.up('KeyD');
    s = await getState(page);
    expect(s.enemiesAlive).toBe(0);
    expect(s.coins - coinsBefore).toBe(3);

    // 4. Boss room (boss-1): Boss has 120 HP, and below half HP enters phase 2 (fires 3-bolt spread).
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('boss-1');
    });
    const bossInit = await getState(page);
    expect(bossInit.roomType).toBe('boss');
    expect(bossInit.enemyInfos?.[0].kind).toBe('boss');
    expect(bossInit.enemyInfos?.[0].hp).toBe(120);

    // 4a. Phase 1 (Boss > 60 HP): single-bolt volleys only — no +3 jump in 4s.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.setHp(30);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(120, 478);
    });
    let phase1MaxStep = 0;
    let phase1SawBolt = false;
    let phase1PrevBolts = 0;
    const phase1Start = Date.now();
    while (Date.now() - phase1Start < 4000) {
      const n = (await getState(page)).enemyBoltsAlive ?? 0;
      if (n > 0) {
        phase1SawBolt = true;
      }
      if (n - phase1PrevBolts > phase1MaxStep) {
        phase1MaxStep = n - phase1PrevBolts;
      }
      phase1PrevBolts = n;
      await page.waitForTimeout(40);
    }
    expect(phase1SawBolt).toBe(true);
    expect(phase1MaxStep).toBeLessThanOrEqual(1);

    // Damage Boss below 60 HP, then move far left to trigger phase 2 3-bolt spread.
    for (let i = 0; i < 8; i += 1) {
      await page.evaluate(() => {
        const b = window.__SIDEVIEW_DEBUG__?.getState().enemyInfos?.[0];
        if (b) {
          window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(b.x - 32, b.bodyBottom - 22);
        }
      });
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(30);
      await page.keyboard.up('KeyD');
      await page.keyboard.down('KeyJ');
      await page.waitForTimeout(520);
      await page.keyboard.up('KeyJ');
      await page.waitForTimeout(340);
      const cur = await getState(page);
      if ((cur.enemyInfos?.[0]?.hp ?? 120) <= 60) {
        break;
      }
    }
    // 4c. Phase 2 (Boss ≤ 60 HP): one volley fires 3 bolts at once.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.setHp(30);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(120, 478);
    });
    let sawTripleVolley = false;
    let phase2PrevBolts = (await getState(page)).enemyBoltsAlive ?? 0;
    const phase2Start = Date.now();
    while (Date.now() - phase2Start < 8000) {
      const n = (await getState(page)).enemyBoltsAlive ?? 0;
      if (n - phase2PrevBolts >= 3) {
        sawTripleVolley = true;
        break;
      }
      phase2PrevBolts = n;
      await page.waitForTimeout(30);
    }
    expect(sawTripleVolley).toBe(true);
  });

  test('B4: boss death clears in-flight bolts so low-HP player stays stageCleared', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, 20261127);

    // Advance along chest route to real Boss slot (roomIndex 5).
    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    await advanceRoom(page, 1); // chest
    await advanceRoom(page, 0); // shop
    await advanceRoom(page, 0); // elite
    await clearCurrentRoom(page);
    await advanceRoom(page, 0); // boss
    expect((await getState(page)).roomType).toBe('boss');

    // Bring Boss down to <= 6 HP.
    for (let i = 0; i < 25; i += 1) {
      const cur = await getState(page);
      const b = cur.enemyInfos?.[0];
      if (!b || b.hp <= 6) {
        break;
      }
      await page.evaluate(
        ({ bx, bb }) => {
          window.__SIDEVIEW_DEBUG__?.setHp(30);
          window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(bx - 28, bb - 22);
        },
        { bx: b.x, bb: b.bodyBottom },
      );
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(30);
      await page.keyboard.up('KeyD');
      await page.keyboard.press('KeyJ');
      await page.waitForTimeout(340);
    }
    const preKill = await getState(page);
    expect(preKill.enemyInfos?.[0]?.hp ?? 999).toBeLessThanOrEqual(6);

    // Move far left so Boss fires a bolt, set HP to 1, then kill Boss while a
    // bolt is in flight. Record the bolt count at the killing moment: without
    // it, a bolt expiring naturally before the kill would still let the
    // post-clear zero-bolt assertion pass.
    let boltsBeforeKill = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.evaluate(() => {
        window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(120, 478);
        window.__SIDEVIEW_DEBUG__?.setHp(30);
      });
      await page.waitForFunction(
        () => (window.__SIDEVIEW_DEBUG__?.getState().enemyBoltsAlive ?? 0) >= 1,
        undefined,
        { timeout: 6000 },
      );
      await page.evaluate(() => {
        window.__SIDEVIEW_DEBUG__?.setHp(1);
        const b = window.__SIDEVIEW_DEBUG__?.getState().enemyInfos?.[0];
        if (b) {
          // 40px 外 (身体间隙 12px): 轻挥 hitbox 前伸 71px 必中, 且不走进
          // Boss 接触范围 (1 HP 贴身 KeyD 会被接触伤害打死)。
          window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(b.x - 40, b.bodyBottom - 22);
        }
      });
      boltsBeforeKill = (await getState(page)).enemyBoltsAlive ?? 0;
      if (boltsBeforeKill > 0) {
        break;
      }
    }
    expect(boltsBeforeKill).toBeGreaterThan(0);
    // 直接挥剑 (facing 在伤害循环的 KeyD 后已是朝右): 命中同步发生,
    // Boss 在挥剑处理前走不过 12px 间隙。
    await page.keyboard.press('KeyJ');

    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().stageCleared === true,
      undefined,
      { timeout: 5000 },
    );
    const cleared = await getState(page);
    expect(cleared.enemyBoltsAlive).toBe(0);

    await page.waitForTimeout(1500);
    const after = await getState(page);
    expect(after.scene).toBe('SideGameScene');
    expect(after.stageCleared).toBe(true);
    expect(after.hp).toBe(1);
  });

  test('invisible-enemy: live chaser parks at a readable standoff, never on the player centre', async ({
    page,
  }) => {
    test.setTimeout(30000);
    await startGame(page, 1005);
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
      window.__SIDEVIEW_DEBUG__?.setHp(30);
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(480, 478);
      window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', 600, 500, false);
    });
    // Let the chaser close the 120px gap (55px/s ≈ 2.2s), then sample 2s.
    await page.waitForTimeout(4000);
    let minDx = Number.POSITIVE_INFINITY;
    const startMs = Date.now();
    while (Date.now() - startMs < 2000) {
      const s = await getState(page);
      const e = s.enemyInfos?.[0];
      if (e) {
        minDx = Math.min(minDx, Math.abs(e.x - s.x));
      }
      await page.waitForTimeout(50);
    }
    const final = await getState(page);
    // The enemy must stay a readable distance off the player's centre:
    // before the fix it parks at |dx| < 6, hidden behind the player sprite
    // (depth 7 < 8, both figures ~44px wide) while still dealing damage.
    expect(minDx).toBeGreaterThanOrEqual(20);
    // ...and it must still be a threat: contact damage keeps ticking at the
    // standoff (body boxes still overlap 4px), so HP must have dropped.
    expect(final.hp).toBeLessThan(30);
    expect(final.enemiesAlive).toBe(1);
  });
});
