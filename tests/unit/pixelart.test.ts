import { describe, expect, it } from 'vitest';
import { GAME_PIXEL_ART } from '../../src/data/pixelart.ts';
import {
  BOSS_P2_CHAR_REMAP,
  BOSS_P2_PALETTE,
  computePlatformTileLayout,
  parsePaletteChar,
  PIXEL_PALETTE,
  remapBossP2Rows,
  validatePixelRows,
} from '../../src/game/pixelart.ts';

/** Boss P1 帧 (5 张): P2 由调色板替换生成, 不另画帧。 */
const BOSS_P1_KEYS = [
  'enemy_boss_walk_1',
  'enemy_boss_walk_2',
  'enemy_boss_windup_1',
  'enemy_boss_bolt_1',
  'enemy_boss_lunge_1',
] as const;

describe('Boss 阶段 2 调色板换色', () => {
  it('双眼位置换色后确为 D (原 5 号灯黄)', () => {
    for (const key of BOSS_P1_KEYS) {
      const rows = GAME_PIXEL_ART[key];
      const p2 = remapBossP2Rows(rows);
      // 双眼是原帧里的 `555` 团块: 行走/蓄势/发弹帧 rows 7–8, 冲锋帧 rows 11–12。
      const eyeRows = rows
        .map((row, y) => (row.includes('555') ? y : -1))
        .filter((y) => y >= 0);
      expect(eyeRows).toHaveLength(2);
      for (const y of eyeRows) {
        for (let x = 0; x < rows[y].length; x += 1) {
          if (rows[y][x] === '5') {
            expect(p2[y][x]).toBe('D');
          }
        }
      }
      // 全帧所有 5 (含蓄势帧胸口亮光里的 5) 都变 D。
      for (let y = 0; y < rows.length; y += 1) {
        for (let x = 0; x < rows[y].length; x += 1) {
          if (rows[y][x] === '5') {
            expect(p2[y][x]).toBe('D');
          }
        }
      }
    }
  });

  it('与 P1 只在指定序号处不同 (3→5, 5→D, 9→4), 且不改形状', () => {
    for (const key of BOSS_P1_KEYS) {
      const rows = GAME_PIXEL_ART[key];
      const p2 = remapBossP2Rows(rows);
      expect(p2).toHaveLength(rows.length);
      let changed = 0;
      let opaqueBefore = 0;
      let opaqueAfter = 0;
      for (let y = 0; y < rows.length; y += 1) {
        expect(p2[y]).toHaveLength(rows[y].length);
        for (let x = 0; x < rows[y].length; x += 1) {
          const from = rows[y][x];
          const to = p2[y][x];
          if (from !== '.') {
            opaqueBefore += 1;
          }
          if (to !== '.') {
            opaqueAfter += 1;
          }
          if (from !== to) {
            changed += 1;
            expect(BOSS_P2_CHAR_REMAP[from]).toBe(to);
          }
        }
      }
      expect(changed).toBeGreaterThan(0);
      // 只换色不改形: 不透明像素数不变, 故受击闪剪影 (enemy_boss_hit) 对 P2 同样有效。
      expect(opaqueAfter).toBe(opaqueBefore);
      // 换色后仍是合法精灵 (32×32、≤12 色)。
      expect(validatePixelRows(p2).valid).toBe(true);
    }
  });

  it('调色板参数版与行字符版是同一映射', () => {
    for (const [from, to] of Object.entries(BOSS_P2_CHAR_REMAP)) {
      const fromIdx = parsePaletteChar(from);
      const toIdx = parsePaletteChar(to);
      expect(fromIdx).not.toBeNull();
      expect(toIdx).not.toBeNull();
      expect(BOSS_P2_PALETTE[fromIdx as number]).toBe(PIXEL_PALETTE[toIdx as number]);
    }
    // 未列出的序号保持原色。
    expect(BOSS_P2_PALETTE[0]).toBe(PIXEL_PALETTE[0]);
    expect(BOSS_P2_PALETTE[4]).toBe(PIXEL_PALETTE[4]);
    expect(BOSS_P2_PALETTE[13]).toBe(PIXEL_PALETTE[13]);
  });
});

describe('computePlatformTileLayout', () => {
  it.each([180, 200, 220, 240, 260])(
    '宽 %d: 左/右端完整 64, 余数只由中段裁切',
    (widthPx) => {
      const segments = computePlatformTileLayout(widthPx);
      expect(segments[0]).toEqual({ key: 'tile_platform_left', offsetX: 0, width: 64 });
      expect(segments[segments.length - 1]).toEqual({
        key: 'tile_platform_right',
        offsetX: widthPx - 64,
        width: 64,
      });
      // 分段连续、无重叠无空缺, 总宽即平台宽。
      let cursor = 0;
      for (const seg of segments) {
        expect(seg.offsetX).toBe(cursor);
        expect(seg.width).toBeGreaterThan(0);
        cursor += seg.width;
      }
      expect(cursor).toBe(widthPx);
      // 中段: 除最后一段外都是满 64; 只有最后一段中段可裁切 (<64)。
      const mids = segments.filter((seg) => seg.key === 'tile_platform_mid');
      expect(mids.length).toBeGreaterThan(0);
      for (const mid of mids.slice(0, -1)) {
        expect(mid.width).toBe(64);
      }
      expect(mids[mids.length - 1].width).toBeLessThanOrEqual(64);
    },
  );

  it('各宽度分段与手算一致', () => {
    expect(computePlatformTileLayout(180).map((seg) => seg.width)).toEqual([64, 52, 64]);
    expect(computePlatformTileLayout(200).map((seg) => seg.width)).toEqual([64, 64, 8, 64]);
    expect(computePlatformTileLayout(220).map((seg) => seg.width)).toEqual([64, 64, 28, 64]);
    expect(computePlatformTileLayout(240).map((seg) => seg.width)).toEqual([64, 64, 48, 64]);
    expect(computePlatformTileLayout(260).map((seg) => seg.width)).toEqual([64, 64, 64, 4, 64]);
  });

  it('过窄平台抛错 (放不下两端)', () => {
    expect(() => computePlatformTileLayout(128)).toThrow(RangeError);
  });
});
