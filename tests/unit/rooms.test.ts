import {
  BOSS_ATTACK_COOLDOWN,
  BOSS_CONTACT_DAMAGE,
  BOSS_MAX_HP,
  BOSS_SPEED,
  ELITE_XP_ORBS,
  ENEMY_CONTACT_DAMAGE,
  SIDE_ENEMY_BODY_HEIGHT,
  SIDE_ENEMY_BODY_WIDTH,
  SIDE_ENEMY_CONTACT_COOLDOWN,
  sideEnemyStatsForKind,
  SWIFT_HP,
} from '../../src/game/balance.ts';
import {
  compensateEnemyBodyScale,
  rectsStrictlyOverlap,
} from '../../src/game/sideFeel.ts';
import { describe, expect, it } from 'vitest';
import {
  chainSignature,
  generateStage,
  getTemplateById,
  isRoomReachable,
  isRoomSpawnsValid,
  isSpawnValid,
  jumpPlan,
  mulberry32,
  pickTemplate,
  ROOM_TEMPLATES,
  TEMPLATES_BY_TYPE,
  type RoomTemplate,
} from '../../src/game/rooms.ts';

function makeTemplate(overrides: Partial<RoomTemplate>): RoomTemplate {
  return {
    id: 'test-template',
    type: 'combat',
    label: '测试',
    platforms: [],
    spawns: [],
    ...overrides,
  };
}

describe('rooms: generateStage', () => {
  it('same seed produces the same chain (slot order and candidate order)', () => {
    const a = generateStage(12345);
    const b = generateStage(12345);
    expect(chainSignature(a)).toBe(chainSignature(b));
    expect(a.seed).toBe(12345);
    expect(a.slots).toHaveLength(6);
    expect(a.slots.map((s) => s.slot.kind)).toEqual([
      'fixed',
      'fixed',
      'choice',
      'fixed',
      'fixed',
      'fixed',
    ]);
  });

  it('different seeds usually produce different chains', () => {
    const sigs = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => chainSignature(generateStage(s))));
    expect(sigs.size).toBeGreaterThan(1);
  });

  it('first slot is entrance, contains at least one shop, last slot is boss', () => {
    const chain = generateStage(999);
    expect(chain.slots[0].candidates[0].type).toBe('entrance');
    expect(chain.slots.some((s) => s.candidates[0].type === 'shop')).toBe(true);
    expect(chain.slots[4].candidates[0].type).toBe('elite');
    const last = chain.slots[chain.slots.length - 1];
    expect(last.candidates[0].type).toBe('boss');
  });

  it('choice slot has two candidates of different reward types', () => {
    const chain = generateStage(4242);
    const choice = chain.slots[2];
    expect(choice.slot.kind).toBe('choice');
    expect(choice.candidates).toHaveLength(2);
    expect(choice.candidates[0].type).not.toBe(choice.candidates[1].type);
    expect(choice.candidates[0].label).not.toBe(choice.candidates[1].label);
    expect(choice.candidates.map((c) => c.type).sort()).toEqual(['chest', 'combat']);
  });

  it('every combat template reward differs from the chest reward', () => {
    // 奖励是 label 里 '·' 后的部分; 分支格的任意战斗/宝箱配对都必须奖励不同,
    // 否则两扇门标的奖励相同、玩家无从按奖励选择 (§6)。
    const rewardOf = (label: string): string => {
      const parts = label.split('·');
      return parts.length > 1 ? (parts[1] as string).trim() : label;
    };
    const chest = getTemplateById('chest-1') as RoomTemplate;
    const chestReward = rewardOf(chest.label);
    for (const combat of TEMPLATES_BY_TYPE.combat) {
      expect(rewardOf(combat.label)).not.toBe(chestReward);
    }
  });

  it('chosen initial values: fixed slots 0, choice slot null', () => {
    const chain = generateStage(7);
    expect(chain.slots[0].chosen).toBe(0);
    expect(chain.slots[1].chosen).toBe(0);
    expect(chain.slots[2].chosen).toBeNull();
    expect(chain.slots[3].chosen).toBe(0);
    expect(chain.slots[4].chosen).toBe(0);
  });

  it('generates a chain in well under 5ms on average', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      generateStage(i);
    }
    expect((performance.now() - start) / 1000).toBeLessThan(5);
  });
});

describe('rooms: handwritten templates', () => {
  it('has exactly 8 templates: 1 entrance, 3 combat, 1 chest, 1 shop, 1 elite, 1 boss', () => {
    const counts = new Map<string, number>();
    for (const t of ROOM_TEMPLATES) {
      counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
    }
    expect(ROOM_TEMPLATES).toHaveLength(8);
    expect(counts.get('entrance')).toBe(1);
    expect(counts.get('combat')).toBe(3);
    expect(counts.get('chest')).toBe(1);
    expect(counts.get('shop')).toBe(1);
    expect(counts.get('elite')).toBe(1);
    expect(counts.get('boss')).toBe(1);
  });

  it('every handwritten template passes isRoomReachable', () => {
    for (const t of ROOM_TEMPLATES) {
      expect(isRoomReachable(t), `${t.id} should be reachable`).toBe(true);
    }
  });

  it('every handwritten template has valid spawns', () => {
    for (const t of ROOM_TEMPLATES) {
      expect(isRoomSpawnsValid(t), `${t.id} spawns should be valid`).toBe(true);
    }
  });

  it('every handwritten template has a full jump plan (all platforms reachable)', () => {
    for (const t of ROOM_TEMPLATES) {
      expect(jumpPlan(t)).toHaveLength(t.platforms.length);
    }
  });

  it('entrance template spawns 3 demons on the ground', () => {
    const entrance = getTemplateById('entrance-1');
    expect(entrance?.spawns).toHaveLength(3);
    expect(entrance?.spawns.every((s) => s.surfaceY === 500)).toBe(true);
  });

  it('shop and chest templates have no enemies', () => {
    expect(getTemplateById('shop-1')?.spawns).toHaveLength(0);
    expect(getTemplateById('chest-1')?.spawns).toHaveLength(0);
  });
});

describe('rooms: isRoomReachable rejects bad templates', () => {
  it('rejects a platform 150px above the ground (rise has no solution)', () => {
    // Top at y=350: rise 150 > 88, and there is no other platform to route via.
    const bad = makeTemplate({
      platforms: [{ x: 480, y: 358, w: 200, h: 16 }],
    });
    expect(isRoomReachable(bad)).toBe(false);
  });

  it('rejects a single platform at rise 88 with a 110px horizontal gap and no detour', () => {
    // P1 is a reachable stepping stone (S1-style, top 412); P2 sits 88px
    // above P1 with its standable interval 110px away (> ~65px allowed),
    // and 176px above the ground, so BFS cannot reach it any other way.
    const bad = makeTemplate({
      platforms: [
        { x: 300, y: 420, w: 240, h: 16 },
        { x: 622, y: 332, w: 240, h: 16 },
      ],
    });
    expect(isRoomReachable(bad)).toBe(false);
  });
});

describe('rooms: canJumpBetween interception boundaries', () => {
  it('a platform exactly at the start/end height does not block the edge', () => {
    // 两块同高平台 (顶面同为 412), 左右分开 578px (> 同高允许值 ~101px),
    // 互相够不着, 都只能从地面直达; 若等高算截挡, 两者都不可达。
    const t = makeTemplate({
      platforms: [
        { x: 150, y: 420, w: 100, h: 16 },
        { x: 800, y: 420, w: 100, h: 16 },
      ],
    });
    expect(isRoomReachable(t)).toBe(true);
  });

  it('a platform strictly between the two heights and overlapping the sweep blocks the edge', () => {
    // P1 (目标, 顶面 412) 在右; P2 (顶面 456, 严格介于 412 与 500 之间)
    // 在左且水平重叠扫掠范围, 挡住地面→P1; P2→P1 的水平间隔 578px
    // 远大于 rise 44 的允许值 ~89px, 所以 P1 无路可达。
    const t = makeTemplate({
      platforms: [
        { x: 150, y: 464, w: 100, h: 16 },
        { x: 800, y: 420, w: 100, h: 16 },
      ],
    });
    expect(isRoomReachable(t)).toBe(false);
  });
});

describe('rooms: spawn validation rejects bad spawns', () => {
  it('rejects a spawn with the right y but a floating x', () => {
    const t = getTemplateById('entrance-1') as RoomTemplate;
    expect(isSpawnValid({ kind: 'paper', footX: 30, surfaceY: 500 }, t)).toBe(false);
  });

  it('rejects a spawn whose y is on no surface', () => {
    const t = getTemplateById('entrance-1') as RoomTemplate;
    expect(isSpawnValid({ kind: 'paper', footX: 500, surfaceY: 450 }, t)).toBe(false);
  });

  it('accepts ground and platform spawns from the handwritten templates', () => {
    const combat = getTemplateById('combat-1') as RoomTemplate;
    expect(isSpawnValid({ kind: 'paper', footX: 480, surfaceY: 388 }, combat)).toBe(true);
    expect(isSpawnValid({ kind: 'paper', footX: 500, surfaceY: 500 }, combat)).toBe(true);
  });
});

describe('rooms: mulberry32 and pickTemplate', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(99)()).not.toBe(mulberry32(100)());
  });

  it('throws when no template in the pool is reachable', () => {
    // 保底不能返回一个已知不可达的模板: 池里一个可达的都没有,
    // 说明手写模板被改坏了, 大声报错而不是把坏房间送进关卡。
    const unreachable = makeTemplate({
      id: 'unreachable',
      platforms: [{ x: 480, y: 358, w: 200, h: 16 }],
    });
    const rng = mulberry32(5);
    expect(() => pickTemplate([unreachable], rng)).toThrow('no reachable template');
  });

  it('falls back to the first reachable template after ten failed draws', () => {
    const bad = makeTemplate({
      id: 'bad',
      platforms: [{ x: 480, y: 358, w: 200, h: 16 }],
    });
    const good = getTemplateById('combat-1') as RoomTemplate;
    // 计数 RNG 每次都抽中 pool[0] (bad, 单平台 rise 150 > 88, 不可达)。
    let draws = 0;
    const rng = (): number => {
      draws += 1;
      return 0.1;
    };
    expect(pickTemplate([bad, good], rng)).toBe(good);
    expect(draws).toBe(10);
  });

  it('pickTemplate tries exactly ten times before falling back to pool[0]', () => {
    const good = getTemplateById('combat-1') as RoomTemplate;
    const bad = makeTemplate({
      id: 'bad',
      platforms: [{ x: 480, y: 358, w: 200, h: 16 }],
    });
    // 计数 RNG 每次都抽中 pool[1] (bad, 单平台 rise 150 > 88, 不可达):
    // 只有抽满 10 次才证明上限被执行, 立即返回的实现会在第 1 次后就停下。
    let draws = 0;
    const rng = (): number => {
      draws += 1;
      return 0.9;
    };
    expect(pickTemplate([good, bad], rng)).toBe(good);
    expect(draws).toBe(10);
  });

  it('pickTemplate returns a reachable template from a mixed pool', () => {
    const bad = makeTemplate({
      id: 'bad',
      platforms: [{ x: 480, y: 358, w: 200, h: 16 }],
    });
    const good = getTemplateById('combat-1') as RoomTemplate;
    // rng() = 0 always picks pool[0] (bad) 10 times, then falls back to pool[0];
    // use a rng that picks the good one first instead.
    const rng = () => 0.9;
    expect(pickTemplate([bad, good], rng)).toBe(good);
  });
});

describe('balance: sideEnemyStatsForKind', () => {
  it('returns expected stats for all 6 enemy kinds', () => {
    const paper = sideEnemyStatsForKind('paper');
    expect(paper.maxHp).toBe(8);
    expect(paper.contactDamage).toBe(1);
    expect(paper.attackCooldown).toBe(1.75);
    expect(ENEMY_CONTACT_DAMAGE).toBe(1);
    expect(SIDE_ENEMY_CONTACT_COOLDOWN).toBe(1.75);

    const lantern = sideEnemyStatsForKind('lantern');
    expect(lantern.maxHp).toBe(paper.maxHp);
    expect(lantern.speed).toBe(paper.speed);
    expect(lantern.contactDamage).toBe(1);
    expect(lantern.attackCooldown).toBe(1.75);
    expect(lantern.coinDrops).toBe(1);

    const swift = sideEnemyStatsForKind('swift');
    expect(swift.maxHp).toBe(2);
    expect(swift.maxHp).toBe(SWIFT_HP);
    expect(swift.speed).toBeCloseTo(paper.speed * 1.5, 4);

    const shooter = sideEnemyStatsForKind('shooter');
    expect(shooter.speed).toBeLessThan(paper.speed);
    expect(shooter.contactDamage).toBe(1);
    expect(shooter.attackCooldown).toBe(1.75);

    const elite = sideEnemyStatsForKind('elite');
    expect(elite.maxHp).toBe(36);
    expect(elite.coinDrops).toBe(3);
    expect(elite.coinDrops).toBe(ELITE_XP_ORBS);

    const boss = sideEnemyStatsForKind('boss');
    expect(boss.maxHp).toBe(BOSS_MAX_HP);
    expect(boss.speed).toBe(BOSS_SPEED);
    expect(boss.contactDamage).toBe(BOSS_CONTACT_DAMAGE);
    expect(boss.attackCooldown).toBe(BOSS_ATTACK_COOLDOWN);
  });
});

describe('sideFeel: compensateEnemyBodyScale & rectsStrictlyOverlap', () => {
  it('keeps enemy physics body 28x46 across visual scales', () => {
    for (const scale of [1, 1.18, 1.25, 1.6, 1.6 * 1.18]) {
      const comp = compensateEnemyBodyScale(scale);
      expect(comp.width * scale).toBeCloseTo(SIDE_ENEMY_BODY_WIDTH, 5);
      expect(comp.height * scale).toBeCloseTo(SIDE_ENEMY_BODY_HEIGHT, 5);
    }
  });

  it('treats touching edges (0px overlap) as non-overlapping', () => {
    const a = { x: 286, y: 452, width: 28, height: 48 };
    const touching = { x: 314, y: 454, width: 28, height: 46 };
    const overlapping = { x: 313, y: 454, width: 28, height: 46 };
    expect(rectsStrictlyOverlap(a, touching)).toBe(false);
    expect(rectsStrictlyOverlap(a, overlapping)).toBe(true);
  });
});
