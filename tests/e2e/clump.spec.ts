import { test, expect, type Page } from '@playwright/test';
import { getState, startGame, clearCurrentRoom } from './helpers.ts';
import { getTemplateById } from '../../src/game/rooms.ts';
import {
  SIDE_ENEMY_VISUAL_GAP,
  SIDE_ENEMY_VISUAL_WIDTH,
} from '../../src/game/balance.ts';

/**
 * 怪叠团 live 回归: 本地 (b) 分离只量身体盒 (28px), 没量精灵视觉重叠。
 * 可见宽度 (SIDE_ENEMY_VISUAL_WIDTH, 由 src/data/pixelart.ts 实测):
 *   paper/lantern 44px, swift 52px, shooter 54px, elite 75px, boss 102px。
 * 视觉可分辨 = 同层两怪中心距 ≥ (可见宽 A + 可见宽 B)/2 + VISUAL_GAP。
 */
const VISUAL_WIDTH = SIDE_ENEMY_VISUAL_WIDTH;
const VISUAL_GAP = SIDE_ENEMY_VISUAL_GAP;
const EPS = 0.01;

interface Sample {
  t: number;
  hp: number;
  px: number;
  timeNow: number;
  infos: NonNullable<Awaited<ReturnType<typeof getState>>['enemyInfos']>;
  signals: NonNullable<Awaited<ReturnType<typeof getState>>['contactSignals']>;
}

async function sampleChase(page: Page, durationMs: number): Promise<Sample[]> {
  const samples: Sample[] = [];
  const startMs = Date.now();
  while (Date.now() - startMs < durationMs) {
    const s = await getState(page);
    samples.push({
      t: Date.now() - startMs,
      hp: s.hp,
      px: s.x,
      timeNow: s.timeNow,
      infos: s.enemyInfos ?? [],
      signals: s.contactSignals ?? [],
    });
    if (s.hp < 10 && s.hp > 0) {
      await page.evaluate(() => window.__SIDEVIEW_DEBUG__?.setHp(30));
    }
    await page.waitForTimeout(50);
  }
  return samples;
}

interface ChaseMetrics {
  total: number;
  warmupSkipped: number;
  bodyOverlapSamples: number;
  maxConsecutiveBodyOverlap: number;
  visualViolationSamples: number;
  maxConsecutiveVisualViolation: number;
  medianMinPairDx: number;
  maxEnemiesWithin32: number;
  /** 3 秒窗口内配对到接触信号的掉血最大值 (2 只同时打人 × 1.75s 冷却 ≈ 4)。 */
  maxPairedDrops3s: number;
  unpairedDrops: number;
  hpMin: number;
}

function analyzeChase(samples: Sample[], warmupMs: number): ChaseMetrics {
  const warm = samples.filter((s) => s.t >= warmupMs);
  let bodyOverlapSamples = 0;
  let maxConsecutiveBodyOverlap = 0;
  let consecBody = 0;
  let visualViolationSamples = 0;
  let maxConsecutiveVisualViolation = 0;
  let consecVisual = 0;
  const minPairDxList: number[] = [];
  let maxEnemiesWithin32 = 0;
  let hpMin = 30;

  for (const s of warm) {
    hpMin = Math.min(hpMin, s.hp);
    const infos = s.infos;
    let anyBodyOverlap = false;
    let anyVisualViolation = false;
    let minDx = Number.POSITIVE_INFINITY;
    for (let i = 0; i < infos.length; i += 1) {
      for (let j = i + 1; j < infos.length; j += 1) {
        const a = infos[i];
        const b = infos[j];
        const overlapY =
          a.bodyTopRaw < b.bodyBottomRaw - EPS && b.bodyTopRaw < a.bodyBottomRaw - EPS;
        if (!overlapY) {
          continue;
        }
        const dx = Math.abs(a.x - b.x);
        minDx = Math.min(minDx, dx);
        const halfSum =
          (a.bodyRightRaw - a.bodyLeftRaw + (b.bodyRightRaw - b.bodyLeftRaw)) * 0.5;
        const cxA = (a.bodyLeftRaw + a.bodyRightRaw) * 0.5;
        const cxB = (b.bodyLeftRaw + b.bodyRightRaw) * 0.5;
        if (Math.abs(cxA - cxB) < halfSum - EPS) {
          anyBodyOverlap = true;
        }
        const visNeed = (VISUAL_WIDTH[a.kind] + VISUAL_WIDTH[b.kind]) / 2 + VISUAL_GAP;
        if (dx < visNeed - EPS) {
          anyVisualViolation = true;
        }
      }
    }
    if (Number.isFinite(minDx)) {
      minPairDxList.push(minDx);
    }
    if (anyBodyOverlap) {
      bodyOverlapSamples += 1;
      consecBody += 1;
      maxConsecutiveBodyOverlap = Math.max(maxConsecutiveBodyOverlap, consecBody);
    } else {
      consecBody = 0;
    }
    if (anyVisualViolation) {
      visualViolationSamples += 1;
      consecVisual += 1;
      maxConsecutiveVisualViolation = Math.max(maxConsecutiveVisualViolation, consecVisual);
    } else {
      consecVisual = 0;
    }
    const near = infos.filter((e) => Math.abs(e.x - s.px) < 32).length;
    maxEnemiesWithin32 = Math.max(maxEnemiesWithin32, near);
  }

  minPairDxList.sort((a, b) => a - b);
  const medianMinPairDx =
    minPairDxList.length > 0
      ? minPairDxList[Math.floor(minPairDxList.length / 2)]
      : Number.NaN;

  // 掉血配对 (B3 同款口径): 每 1 HP 配一条未消费的接触信号 (≤500ms), 3 秒窗口求和。
  const consumed = new Set<string>();
  const dropEvents: { t: number; paired: boolean }[] = [];
  let prevHp = samples[0]?.hp ?? 30;
  for (const s of samples) {
    if (s.hp > prevHp) {
      prevHp = s.hp; // 回血段, 重置基线
      continue;
    }
    if (s.hp < prevHp) {
      for (let d = 0; d < prevHp - s.hp; d += 1) {
        const match = s.signals.find(
          (sig) =>
            !consumed.has(`${sig.enemyId}:${sig.timeMs}`) &&
            s.infos.some((e) => e.id === sig.enemyId) &&
            sig.timeMs <= s.timeNow &&
            s.timeNow - sig.timeMs <= 500,
        );
        if (match) {
          consumed.add(`${match.enemyId}:${match.timeMs}`);
          dropEvents.push({ t: s.t, paired: true });
        } else {
          dropEvents.push({ t: s.t, paired: false });
        }
      }
      prevHp = s.hp;
    }
  }
  let maxPairedDrops3s = 0;
  for (const ev of dropEvents) {
    if (!ev.paired) {
      continue;
    }
    const inWindow = dropEvents.filter(
      (o) => o.paired && o.t >= ev.t && o.t < ev.t + 3000,
    ).length;
    maxPairedDrops3s = Math.max(maxPairedDrops3s, inWindow);
  }
  const unpairedDrops = dropEvents.filter((e) => !e.paired).length;

  return {
    total: warm.length,
    warmupSkipped: samples.length - warm.length,
    bodyOverlapSamples,
    maxConsecutiveBodyOverlap,
    visualViolationSamples,
    maxConsecutiveVisualViolation,
    medianMinPairDx,
    maxEnemiesWithin32,
    maxPairedDrops3s,
    unpairedDrops,
    hpMin,
  };
}

function logMetrics(name: string, m: ChaseMetrics): void {
  // eslint-disable-next-line no-console
  console.log(
    `[clump] ${name}: samples=${m.total} bodyOverlap=${m.bodyOverlapSamples} ` +
      `maxConsecBody=${m.maxConsecutiveBodyOverlap} ` +
      `visualViolations=${m.visualViolationSamples} ` +
      `(${(100 * m.visualViolationSamples / Math.max(1, m.total)).toFixed(1)}%) ` +
      `maxConsecVisual=${m.maxConsecutiveVisualViolation} ` +
      `medianMinPairDx=${m.medianMinPairDx} maxNear32=${m.maxEnemiesWithin32} ` +
      `maxPairedDrops3s=${m.maxPairedDrops3s} unpairedDrops=${m.unpairedDrops} hpMin=${m.hpMin}`,
  );
}

test('clump: 5 mixed enemies chasing for 15s stay visually separated', async ({ page }) => {
  test.setTimeout(90000);
  await startGame(page, 2001);
  await page.evaluate(() => {
    window.__SIDEVIEW_DEBUG__?.clearEnemies?.();
    window.__SIDEVIEW_DEBUG__?.setHp(30);
    window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(480, 478);
    window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', 380, 500, false);
    window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('lantern', 420, 500, false);
    window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('swift', 530, 500, false);
    window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('shooter', 570, 500, false);
    window.__SIDEVIEW_DEBUG__?.placeTestEnemy?.('paper', 610, 500, false);
  });

  const samples = await sampleChase(page, 15000);
  const m = analyzeChase(samples, 1000);
  logMetrics('ground-15s', m);
  await page.screenshot({ path: 'test-results/clump-ground.png' });

  expect(samples.length).toBeGreaterThan(100);
  // 身体盒仍不叠 (旧 B3 口径)。
  expect(m.maxConsecutiveBodyOverlap).toBeLessThanOrEqual(1);
  // 视觉上能分辨出个体: 违例采样 <5%, 连续违例 ≤2 帧采样, 中位最小中心距 ≥52px。
  expect(m.visualViolationSamples).toBeLessThanOrEqual(Math.ceil(m.total * 0.05));
  expect(m.maxConsecutiveVisualViolation).toBeLessThanOrEqual(2);
  expect(m.medianMinPairDx).toBeGreaterThanOrEqual(52);
  // 同一时刻贴在玩家视觉上 (中心距 <32px) 的怪 ≤2 只。
  expect(m.maxEnemiesWithin32).toBeLessThanOrEqual(2);
  // 3 秒内配对掉血 ≤5 (2 只同时打人 + 容差 1 次换位穿插)。
  expect(m.maxPairedDrops3s).toBeLessThanOrEqual(5);
});

test('clump: combat-3 platform enemies chasing for 10s stay visually separated', async ({
  page,
}) => {
  test.setTimeout(60000);
  await startGame(page, 2002);
  await page.evaluate(() => {
    window.__SIDEVIEW_DEBUG__?.enterTemplate?.('combat-3');
    window.__SIDEVIEW_DEBUG__?.setHp(30);
  });
  await page.waitForTimeout(300);

  const samples = await sampleChase(page, 10000);
  const m = analyzeChase(samples, 2000);
  logMetrics('combat3-10s', m);
  await page.screenshot({ path: 'test-results/clump-combat3.png' });

  expect(samples.length).toBeGreaterThan(60);
  expect(m.maxConsecutiveBodyOverlap).toBeLessThanOrEqual(1);
  expect(m.visualViolationSamples).toBeLessThanOrEqual(Math.ceil(m.total * 0.05));
  expect(m.maxConsecutiveVisualViolation).toBeLessThanOrEqual(2);
  expect(m.medianMinPairDx).toBeGreaterThanOrEqual(52);
  expect(m.maxEnemiesWithin32).toBeLessThanOrEqual(2);
  expect(m.maxPairedDrops3s).toBeLessThanOrEqual(5);
});

test('combat-3: exit door "继续前进" is not hidden behind a platform', async ({ page }) => {
  test.setTimeout(120000);
  await startGame(page, 2003);
  await page.evaluate(() => {
    window.__SIDEVIEW_DEBUG__?.enterTemplate?.('combat-3');
  });
  await clearCurrentRoom(page);

  const state = await getState(page);
  expect(state.roomCleared).toBe(true);
  expect(state.doors).toEqual([{ choice: 0, label: '继续前进' }]);
  await page.screenshot({ path: 'test-results/combat3-door.png' });

  // 门的几何位置: 单门 x=785, y=SIDE_GROUND_Y-45=455, 60×90; 标牌在门上方 y≈397。
  const template = getTemplateById('combat-3');
  expect(template).toBeDefined();
  const doorRect = { left: 755, right: 815, top: 410, bottom: 500 };
  const labelRect = { left: 755, right: 815, top: 391, bottom: 403 };
  for (const p of template!.platforms) {
    const plat = { left: p.x - p.w / 2, right: p.x + p.w / 2, top: p.y - p.h / 2, bottom: p.y + p.h / 2 };
    const overlapsDoor =
      plat.left < doorRect.right && doorRect.left < plat.right &&
      plat.top < doorRect.bottom && doorRect.top < plat.bottom;
    const overlapsLabel =
      plat.left < labelRect.right && labelRect.left < plat.right &&
      plat.top < labelRect.bottom && labelRect.top < plat.bottom;
    expect(overlapsDoor).toBe(false);
    expect(overlapsLabel).toBe(false);
  }
});

test('shop: counter has no collision, player walks straight through it', async ({ page }) => {
  test.setTimeout(60000);
  await startGame(page, 2004);
  await page.evaluate(() => {
    window.__SIDEVIEW_DEBUG__?.enterTemplate?.('shop-1');
  });
  await page.waitForFunction(
    () => window.__SIDEVIEW_DEBUG__?.getState().roomCleared === true,
    undefined,
    { timeout: 5000 },
  );

  // 柜台在 x 130–270: 不跳、一直按住 D 走过, 脚底应始终贴地 (bodyBottom≈500)。
  let minBodyBottom = 500;
  let maxX = 0;
  await page.keyboard.down('KeyD');
  const startMs = Date.now();
  while (Date.now() - startMs < 8000) {
    const s = await getState(page);
    minBodyBottom = Math.min(minBodyBottom, s.bodyBottom);
    maxX = Math.max(maxX, s.x);
    if (s.x > 400) {
      break;
    }
    await page.waitForTimeout(50);
  }
  await page.keyboard.up('KeyD');

  expect(maxX).toBeGreaterThan(400);
  expect(minBodyBottom).toBeGreaterThanOrEqual(497);
});
