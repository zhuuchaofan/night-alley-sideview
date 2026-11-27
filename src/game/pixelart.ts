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
 */
export function validatePixelRows(
  rows: readonly string[],
  expectedSize = SPRITE_SIZE,
  palette: readonly string[] = PIXEL_PALETTE,
  maxColors = MAX_COLORS_PER_SPRITE,
): PixelArtValidationResult {
  const errors: string[] = [];
  const usedIndices = new Set<number>();

  if (rows.length !== expectedSize) {
    errors.push(`Expected ${expectedSize} rows, got ${rows.length}`);
  }

  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y];
    if (row.length !== expectedSize) {
      errors.push(`Row ${y} expected length ${expectedSize}, got ${row.length}`);
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

  const validation = validatePixelRows(rows, rows.length, palette, MAX_COLORS_PER_SPRITE);
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

  pixelRowsToSilhouetteTexture(scene, 'player_hit', GAME_PIXEL_ART.player_idle, PALETTE.vermilion);
  pixelRowsToSilhouetteTexture(scene, 'enemy_paper_hit', GAME_PIXEL_ART.enemy_paper, PALETTE.paperWhite);
  pixelRowsToSilhouetteTexture(scene, 'enemy_lantern_hit', GAME_PIXEL_ART.enemy_lantern, PALETTE.paperWhite);
  pixelRowsToSilhouetteTexture(scene, 'enemy_swift_hit', GAME_PIXEL_ART.enemy_swift, PALETTE.paperWhite);
  pixelRowsToSilhouetteTexture(scene, 'enemy_shooter_hit', GAME_PIXEL_ART.enemy_shooter, PALETTE.paperWhite);
  pixelRowsToSilhouetteTexture(scene, 'enemy_elite_hit', GAME_PIXEL_ART.enemy_elite, PALETTE.paperWhite);
  pixelRowsToSilhouetteTexture(scene, 'enemy_boss_hit', GAME_PIXEL_ART.enemy_boss, PALETTE.paperWhite);
}

/**
 * Builds the hard-edged pixel night alley backdrop (tiled brick floor, side walls,
 * hanging lanterns with dithered warm glow, and dithered corner vignettes).
 */
export function buildNightAlleyBackdrop(scene: Phaser.Scene, topY: number): void {
  const areaHeight = ARENA_HEIGHT - topY;
  scene.add
    .tileSprite(0, topY, ARENA_WIDTH, areaHeight, 'alley_tile')
    .setOrigin(0, 0)
    .setDepth(0);

  // Side alley walls (64px wide each, leaving 832px clear central lane)
  scene.add
    .tileSprite(0, topY, 64, areaHeight, 'alley_wall_tile')
    .setOrigin(0, 0)
    .setDepth(1);
  scene.add
    .tileSprite(ARENA_WIDTH - 64, topY, 64, areaHeight, 'alley_wall_tile')
    .setOrigin(0, 0)
    .setFlipX(true)
    .setDepth(1);

  // Hanging wall lanterns + hard-edged dithered warm light pools
  const lanternYs = topY > 0 ? [185, 415] : [165, 395];
  for (const ly of lanternYs) {
    scene.add.image(62, ly + 8, 'lantern_glow').setDisplaySize(96, 96).setDepth(1);
    scene.add.image(42, ly, 'wall_lantern').setDepth(2);

    scene.add.image(ARENA_WIDTH - 62, ly + 8, 'lantern_glow').setDisplaySize(96, 96).setDepth(1);
    scene.add.image(ARENA_WIDTH - 42, ly, 'wall_lantern').setFlipX(true).setDepth(2);
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
