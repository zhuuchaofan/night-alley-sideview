import type Phaser from 'phaser';
import { GAME_PIXEL_ART, PixelArtKey } from '../data/pixelart.ts';
import { ARENA_HEIGHT, ARENA_WIDTH } from './balance.ts';

/**
 * 16 色主调色板索引表（0–F），严格对应 ART_STYLE.md。
 */
export const PIXEL_PALETTE: readonly string[] = [
  '#17120C', // 0 墨黑
  '#2E2118', // 1 深木
  '#5A3A22', // 2 木棕
  '#8A5A33', // 3 铜棕
  '#C9973F', // 4 黄铜
  '#E8B34B', // 5 灯黄
  '#F2E3C6', // 6 烛光
  '#FBF6E9', // 7 纸白
  '#10182B', // 8 夜黑
  '#1B2A4A', // 9 深蓝
  '#2E4A73', // A 夜蓝
  '#4E739E', // B 雾蓝
  '#8FA8C8', // C 银蓝
  '#B03A2E', // D 朱红
  '#4E7A5A', // E 玉绿
  '#D9A066', // F 旧纸
] as const;

export const PALETTE = {
  inkBlack: '#17120C',
  darkWood: '#2E2118',
  woodBrown: '#5A3A22',
  copperBrown: '#8A5A33',
  brass: '#C9973F',
  lanternYellow: '#E8B34B',
  candleLight: '#F2E3C6',
  paperWhite: '#FBF6E9',
  nightBlack: '#10182B',
  deepBlue: '#1B2A4A',
  nightBlue: '#2E4A73',
  fogBlue: '#4E739E',
  silverBlue: '#8FA8C8',
  vermilion: '#B03A2E',
  jadeGreen: '#4E7A5A',
  oldPaper: '#D9A066',
} as const;

export const MAX_COLORS_PER_SPRITE = 12;
export const SPRITE_SIZE = 32;
export const SPRITE_PIXEL_SCALE = 2;
export const RENDERED_SPRITE_SIZE = SPRITE_SIZE * SPRITE_PIXEL_SCALE;

export interface PixelArtValidationResult {
  valid: boolean;
  errors: string[];
  colorCount: number;
  usedColors: string[];
}

/**
 * Maps a single palette character ('0'-'9', 'A'-'F', case-insensitive) to palette index 0..15,
 * or returns -1 for transparent ('.') and null for invalid characters.
 */
export function parsePaletteChar(ch: string): number | null {
  if (ch === '.') {
    return -1;
  }
  if (ch.length !== 1) {
    return null;
  }
  const code = ch.toUpperCase().charCodeAt(0);
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  if (code >= 65 && code <= 70) {
    return code - 55;
  }
  return null;
}

/**
 * Pure validator for pixel art rows: checks dimensions, palette bounds, and <=12 color limit.
 * Square sprites pass expectedSize for both dims; rectangular tiles (platform 32x8,
 * door 32x48, ground 32x20, counter 64x32, chest 32x24, ...) pass their own width.
 */
export function validatePixelRows(
  rows: readonly string[],
  expectedSize = SPRITE_SIZE,
  palette: readonly string[] = PIXEL_PALETTE,
  maxColors = MAX_COLORS_PER_SPRITE,
  expectedWidth = expectedSize,
): PixelArtValidationResult {
  const errors: string[] = [];
  const usedIndices = new Set<number>();

  if (rows.length !== expectedSize) {
    errors.push(`Expected ${expectedSize} rows, got ${rows.length}`);
  }

  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y];
    if (row.length !== expectedWidth) {
      errors.push(`Row ${y} expected length ${expectedWidth}, got ${row.length}`);
    }
    for (let x = 0; x < row.length; x += 1) {
      const idx = parsePaletteChar(row[x]);
      if (idx === null) {
        errors.push(`Invalid char '${row[x]}' at (${x}, ${y})`);
      } else if (idx >= 0) {
        if (idx >= palette.length) {
          errors.push(`Palette index ${idx} out of bounds at (${x}, ${y})`);
        } else {
          usedIndices.add(idx);
        }
      }
    }
  }

  if (usedIndices.size === 0) {
    errors.push('Sprite has no visible pixels');
  }

  if (usedIndices.size > maxColors) {
    errors.push(`Sprite uses ${usedIndices.size} colors, exceeding max ${maxColors}`);
  }

  const usedColors = [...usedIndices].sort((a, b) => a - b).map((i) => palette[i]);

  return {
    valid: errors.length === 0,
    errors,
    colorCount: usedIndices.size,
    usedColors,
  };
}

/**
 * Renders 32x32 palette-indexed rows onto an in-memory canvas (scaled 2x2 nearest-neighbor
 * to 64x64 logical pixels) and registers it as a Phaser texture (idempotent).
 */
export function pixelRowsToTexture(
  scene: Phaser.Scene,
  key: string,
  rows: readonly string[],
  palette: readonly string[] = PIXEL_PALETTE,
  pixelScale = SPRITE_PIXEL_SCALE,
): string {
  if (scene.textures.exists(key)) {
    return key;
  }

  const validation = validatePixelRows(
    rows,
    rows.length,
    palette,
    MAX_COLORS_PER_SPRITE,
    rows[0]?.length ?? rows.length,
  );
  if (!validation.valid) {
    throw new Error(`Invalid pixel art for texture "${key}": ${validation.errors.join('; ')}`);
  }

  const height = rows.length;
  const width = rows[0]?.length ?? 0;

  const canvas = document.createElement('canvas');
  canvas.width = width * pixelScale;
  canvas.height = height * pixelScale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(`Failed to acquire 2D context for pixel art "${key}"`);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    for (let x = 0; x < width; x += 1) {
      const idx = parsePaletteChar(row[x]);
      if (idx !== null && idx >= 0) {
        ctx.fillStyle = palette[idx];
        ctx.fillRect(x * pixelScale, y * pixelScale, pixelScale, pixelScale);
      }
    }
  }

  const texture = scene.textures.addCanvas(key, canvas);
  // Phaser.Textures.FilterMode.NEAREST === 1
  texture?.setFilter(1);
  return key;
}

/**
 * Generates a solid-color silhouette texture from `rows` for Canvas2D hit-flashes
 * (Phaser Canvas renderer ignores WebGL setTintFill).
 */
export function pixelRowsToSilhouetteTexture(
  scene: Phaser.Scene,
  key: string,
  rows: readonly string[],
  fillHex: string,
  pixelScale = SPRITE_PIXEL_SCALE,
): string {
  if (scene.textures.exists(key)) {
    return key;
  }

  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const canvas = document.createElement('canvas');
  canvas.width = width * pixelScale;
  canvas.height = height * pixelScale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(`Failed to acquire 2D context for silhouette "${key}"`);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fillHex;

  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    for (let x = 0; x < width; x += 1) {
      if (row[x] !== '.') {
        ctx.fillRect(x * pixelScale, y * pixelScale, pixelScale, pixelScale);
      }
    }
  }

  const texture = scene.textures.addCanvas(key, canvas);
  texture?.setFilter(1);
  return key;
}

function remapPalette(overrides: Partial<Record<number, string>>): string[] {
  return PIXEL_PALETTE.map((hex, idx) => overrides[idx] ?? hex);
}

export const EVOLVED_SLASH_PALETTE = remapPalette({
  4: PALETTE.vermilion, // #B03A2E
  5: PALETTE.vermilion, // #B03A2E
  6: PALETTE.oldPaper, // #D9A066
});

export const EVOLVED_DART_PALETTE = remapPalette({
  3: PALETTE.nightBlue, // #2E4A73
  4: PALETTE.fogBlue, // #4E739E
  5: PALETTE.silverBlue, // #8FA8C8
});

export const EVOLVED_LANTERN_PALETTE = remapPalette({
  5: PALETTE.candleLight, // #F2E3C6
  6: PALETTE.paperWhite, // #FBF6E9
  13: PALETTE.jadeGreen, // #4E7A5A
});

/**
 * Boss 阶段 2 换色 (设计文档 §1.2, v2: 不手画, 代码调色板替换):
 * 从 5 张 P1 帧按调色板替换生成 `enemy_boss_p2_*`。P1 帧实测 (src/data/pixelart.ts):
 * - 双眼: 5 号灯黄, rows 7–8 两处 `555` (冲锋帧 rows 11–12, 下蹲移位) → 朱红 D,
 *   与袍身同色, 即炽红眼; 蓄势帧胸口亮光里的 5 也一并变红 (余烬胸光)。
 * - 犄角描边: 3 号铜棕, 只出现在犄角行 (rows 2–3, 冲锋帧 rows 6–7) → 灯黄 5。
 * - 袍身暗结: 9 号深蓝, 袍身 rows 16/19 两处 `99` (冲锋帧无) → 黄铜 4。
 * 其余序号 (0 描边、4 犄角、6/7 火光与齿、D 袍身) 不动。
 * 注意: 调色板替换是整序号换色, 做不出 v1 手画版的两处逐像素改动
 * (犄角尖多出的 1 格 5、袍摆底行的 5/4 点状余烬边), 以本映射为准。
 */
export const BOSS_P2_PALETTE = remapPalette({
  3: PALETTE.lanternYellow, // 犄角描边 3 → 灯黄 5
  5: PALETTE.vermilion, // 双眼 5 → 朱红 D
  9: PALETTE.brass, // 袍身暗结 9 → 黄铜 4
});

/** 与 BOSS_P2_PALETTE 同一映射的行字符版 (单测用, 不走 Phaser)。 */
export const BOSS_P2_CHAR_REMAP: Readonly<Record<string, string>> = {
  '3': '5',
  '5': 'D',
  '9': '4',
};

/** 纯函数: 对 P1 Boss 帧行做 P2 换色, 只改 BOSS_P2_CHAR_REMAP 列出的序号, 不改形状。 */
export function remapBossP2Rows(rows: readonly string[]): string[] {
  return rows.map((row) => [...row].map((ch) => BOSS_P2_CHAR_REMAP[ch] ?? ch).join(''));
}

export type PlatformTileKey = 'tile_platform_left' | 'tile_platform_mid' | 'tile_platform_right';

export interface PlatformTileSegment {
  /** 三段瓦片键名。 */
  key: PlatformTileKey;
  /** 相对平台左沿的横向偏移 (px)。 */
  offsetX: number;
  /** 本段显示宽 (px)。 */
  width: number;
}

/** 平台端件宽 (64px = 32 格 × 2px); 中段单块同样 64px 宽。 */
export const PLATFORM_TILE_END_WIDTH = 64;
export const PLATFORM_TILE_MID_WIDTH = 64;

/**
 * 纯函数: 平台三段式布局 (设计文档 §3.4)。
 * 左端 64 + 中段若干 + 右端 64; 余数只由中段裁切 (最后一段中段不足 64 时按余数宽显示),
 * 左/右端完整保留, 不得出现半块端件。要求 widthPx > 128 (两端放得下)。
 */
export function computePlatformTileLayout(widthPx: number): PlatformTileSegment[] {
  if (widthPx <= PLATFORM_TILE_END_WIDTH * 2) {
    throw new RangeError(
      `Platform width ${widthPx} is too narrow for two ${PLATFORM_TILE_END_WIDTH}px end tiles`,
    );
  }
  const segments: PlatformTileSegment[] = [
    { key: 'tile_platform_left', offsetX: 0, width: PLATFORM_TILE_END_WIDTH },
  ];
  let offsetX = PLATFORM_TILE_END_WIDTH;
  let midRemaining = widthPx - PLATFORM_TILE_END_WIDTH * 2;
  while (midRemaining > 0) {
    const width = Math.min(PLATFORM_TILE_MID_WIDTH, midRemaining);
    segments.push({ key: 'tile_platform_mid', offsetX, width });
    offsetX += width;
    midRemaining -= width;
  }
  segments.push({
    key: 'tile_platform_right',
    offsetX: widthPx - PLATFORM_TILE_END_WIDTH,
    width: PLATFORM_TILE_END_WIDTH,
  });
  return segments;
}

/**
 * Registers all game pixel art textures and Canvas2D hit-flash silhouettes idempotently.
 */
export function ensureGameTextures(scene: Phaser.Scene): void {
  const keys = Object.keys(GAME_PIXEL_ART) as PixelArtKey[];
  for (const key of keys) {
    pixelRowsToTexture(scene, key, GAME_PIXEL_ART[key]);
  }

  pixelRowsToTexture(scene, 'slash_arc_evolved', GAME_PIXEL_ART.slash_arc, EVOLVED_SLASH_PALETTE);
  pixelRowsToTexture(scene, 'coin_dart_evolved', GAME_PIXEL_ART.coin_dart, EVOLVED_DART_PALETTE);
  pixelRowsToTexture(
    scene,
    'lantern_ring_1_evolved',
    GAME_PIXEL_ART.lantern_ring_1,
    EVOLVED_LANTERN_PALETTE,
  );
  pixelRowsToTexture(
    scene,
    'lantern_ring_2_evolved',
    GAME_PIXEL_ART.lantern_ring_2,
    EVOLVED_LANTERN_PALETTE,
  );

  // Boss 阶段 2: 由 P1 帧调色板替换生成 (数据文件里的手画 P2 键删除后由这里注册;
  // pixelRowsToTexture 在纹理已存在时直接返回, 故删除前后都正确)。
  pixelRowsToTexture(
    scene,
    'enemy_boss_p2_walk_1',
    GAME_PIXEL_ART.enemy_boss_walk_1,
    BOSS_P2_PALETTE,
  );
  pixelRowsToTexture(
    scene,
    'enemy_boss_p2_walk_2',
    GAME_PIXEL_ART.enemy_boss_walk_2,
    BOSS_P2_PALETTE,
  );
  pixelRowsToTexture(
    scene,
    'enemy_boss_p2_windup_1',
    GAME_PIXEL_ART.enemy_boss_windup_1,
    BOSS_P2_PALETTE,
  );
  pixelRowsToTexture(
    scene,
    'enemy_boss_p2_bolt_1',
    GAME_PIXEL_ART.enemy_boss_bolt_1,
    BOSS_P2_PALETTE,
  );
  pixelRowsToTexture(
    scene,
    'enemy_boss_p2_lunge_1',
    GAME_PIXEL_ART.enemy_boss_lunge_1,
    BOSS_P2_PALETTE,
  );

  pixelRowsToSilhouetteTexture(scene, 'player_hit', GAME_PIXEL_ART.player_idle, PALETTE.vermilion);
  pixelRowsToSilhouetteTexture(scene, 'enemy_paper_hit', GAME_PIXEL_ART.enemy_paper, PALETTE.paperWhite);
  pixelRowsToSilhouetteTexture(scene, 'enemy_lantern_hit', GAME_PIXEL_ART.enemy_lantern, PALETTE.paperWhite);
  pixelRowsToSilhouetteTexture(scene, 'enemy_swift_hit', GAME_PIXEL_ART.enemy_swift, PALETTE.paperWhite);
  pixelRowsToSilhouetteTexture(scene, 'enemy_shooter_hit', GAME_PIXEL_ART.enemy_shooter, PALETTE.paperWhite);
  pixelRowsToSilhouetteTexture(scene, 'enemy_elite_hit', GAME_PIXEL_ART.enemy_elite, PALETTE.paperWhite);
  // P2 与 P1 同剪影 (换色不改形状), 受击闪共用此键, 与阶段无关。
  pixelRowsToSilhouetteTexture(scene, 'enemy_boss_hit', GAME_PIXEL_ART.enemy_boss, PALETTE.paperWhite);
}

/**
 * 四层夜巷背景 (depth 总表 §3.5):
 * L0 天空 (depth 0): bg_sky 横向平铺一带 (64px 高, 月亮只出现一次) +
 *   decor_cloud 横向平铺、tilePositionX 以约 1px/s 缓慢漂移;
 * L1 中景 (depth 1): bg_houses 横向平铺一带 (64px 高, 紧贴天空带下方);
 * L2 巷墙 (depth 2–3): alley_wall_tile 两侧墙、灯晕 depth 2、wall_lantern
 *   depth 3 带 ±2px 缓摆、alley_corner depth 3。
 * 整面 alley_tile 平铺已删: 地面改由场景的 tile_ground 承担。
 * 注意: bg_sky/bg_houses 不纵向满铺——纵向铺会在画面里重复出多个月亮,
 * 且 bg_houses 全不透明会把天空整层盖住; 两带下方露出的画布底色 #10182B
 * 与天空素色 (调色板 8) 是同一色, 视觉上连续。
 */
export function buildNightAlleyBackdrop(scene: Phaser.Scene, topY: number): void {
  const areaHeight = ARENA_HEIGHT - topY;
  // L0 远景: 夜空一带 + 云烟漂移 (64px 一循环, 64s 走完 = 1px/s, 循环接缝无痕)。
  scene.add.tileSprite(0, topY, ARENA_WIDTH, 64, 'bg_sky').setOrigin(0, 0).setDepth(0);
  // 月亮 (bg_moon 8×8 格 = 16×16 显示): 天空带内只放一次, depth 0。
  // x=792: 最右 HUD 文字「疾攻 …」在 size 24 下宽 108px、止于 x=768, 月亮左沿 776 留 8px 空;
  // 中心 y=52 (占 y 44–60): 正好卡在 HUD 条 (y 0–44) 与顶檐不透明带 (y 60–84) 之间的缝里, 全程可见。
  scene.add.image(792, topY + 52, 'bg_moon').setDepth(0);
  const cloud = scene.add
    .tileSprite(0, topY + 36, ARENA_WIDTH, 16, 'decor_cloud')
    .setOrigin(0, 0)
    .setDepth(0);
  scene.tweens.add({
    targets: cloud,
    tilePositionX: 64,
    duration: 64000,
    repeat: -1,
  });

  // L1 中景: 中层民居一带。
  scene.add
    .tileSprite(0, topY + 64, ARENA_WIDTH, 64, 'bg_houses')
    .setOrigin(0, 0)
    .setDepth(1);

  // L2 近景: 两侧巷墙。
  scene.add
    .tileSprite(0, topY, 64, areaHeight, 'alley_wall_tile')
    .setOrigin(0, 0)
    .setDepth(2);
  scene.add
    .tileSprite(ARENA_WIDTH - 64, topY, 64, areaHeight, 'alley_wall_tile')
    .setOrigin(0, 0)
    .setFlipX(true)
    .setDepth(2);

  // Hanging wall lanterns + hard-edged dithered warm light pools
  const lanternYs = topY > 0 ? [185, 415] : [165, 395];
  for (const ly of lanternYs) {
    scene.add.image(62, ly + 8, 'lantern_glow').setDisplaySize(96, 96).setDepth(2);
    const leftLantern = scene.add.image(40, ly, 'wall_lantern').setDepth(3);
    scene.tweens.add({
      targets: leftLantern,
      x: 44,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    scene.add.image(ARENA_WIDTH - 62, ly + 8, 'lantern_glow').setDisplaySize(96, 96).setDepth(2);
    const rightLantern = scene.add
      .image(ARENA_WIDTH - 40, ly, 'wall_lantern')
      .setFlipX(true)
      .setDepth(3);
    scene.tweens.add({
      targets: rightLantern,
      x: ARENA_WIDTH - 44,
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  // Hard-edged pixel-dithered corner vignettes
  scene.add.image(0, topY, 'alley_corner').setOrigin(0, 0).setDisplaySize(128, 128).setDepth(3);
  scene.add
    .image(ARENA_WIDTH, topY, 'alley_corner')
    .setOrigin(1, 0)
    .setFlipX(true)
    .setDisplaySize(128, 128)
    .setDepth(3);
  scene.add
    .image(0, ARENA_HEIGHT, 'alley_corner')
    .setOrigin(0, 1)
    .setFlipY(true)
    .setDisplaySize(128, 128)
    .setDepth(3);
  scene.add
    .image(ARENA_WIDTH, ARENA_HEIGHT, 'alley_corner')
    .setOrigin(1, 1)
    .setFlipX(true)
    .setFlipY(true)
    .setDisplaySize(128, 128)
    .setDepth(3);
}
