import type Phaser from 'phaser';
import pixelFontRaw from '../data/pixel-font.json';

export const PIXEL_FONT_KEY = 'pixel';
export const PIXEL_FONT_TEXTURE_KEY = 'pixel-font-atlas';

export interface PixelFontGlyph {
  advance: number;
  xoffset: number;
  yoffset: number;
  rows: string[];
}

export interface PixelFontJson {
  font: string;
  version: string;
  size: number;
  lineHeight?: number;
  glyphs: Record<string, PixelFontGlyph>;
}

export interface PixelAtlasPlacement {
  char: string;
  charCode: number;
  x: number;
  y: number;
  width: number;
  height: number;
  glyph: PixelFontGlyph;
}

export interface PixelAtlasLayout {
  width: number;
  height: number;
  placements: PixelAtlasPlacement[];
}

export interface PixelTextOptions {
  size?: 12 | 24 | 48;
  color?: string | number;
  origin?: number | readonly [number, number];
  align?: number;
  lineSpacing?: number;
}

export const PIXEL_FONT_DATA: PixelFontJson = pixelFontRaw as PixelFontJson;

export function parseHexColor(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

/**
 * Pure layout calculator: packs glyphs row-by-row with 0 spacing between glyphs.
 */
export function computeAtlasLayout(
  fontJson: PixelFontJson,
  maxRowWidth = 512,
): PixelAtlasLayout {
  const entries = Object.entries(fontJson.glyphs).sort(
    ([a], [b]) => a.charCodeAt(0) - b.charCodeAt(0),
  );

  const placements: PixelAtlasPlacement[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = fontJson.size;
  let usedWidth = 0;

  for (const [char, glyph] of entries) {
    const height = glyph.rows.length > 0 ? glyph.rows.length : fontJson.size;
    const width = glyph.rows[0]?.length ?? glyph.advance;

    if (cursorX > 0 && cursorX + width > maxRowWidth) {
      usedWidth = Math.max(usedWidth, cursorX);
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = fontJson.size;
    }

    placements.push({
      char,
      charCode: char.charCodeAt(0),
      x: cursorX,
      y: cursorY,
      width,
      height,
      glyph,
    });

    cursorX += width;
    rowHeight = Math.max(rowHeight, height);
  }

  usedWidth = Math.max(usedWidth, cursorX, 1);
  const totalHeight = Math.max(cursorY + rowHeight, fontJson.size);

  return {
    width: usedWidth,
    height: totalHeight,
    placements,
  };
}

export type PixelBitmapFontCharacterData =
  Phaser.Types.GameObjects.BitmapText.BitmapFontCharacterData & {
    xAdvance: number;
  };

export interface PixelBitmapFontData
  extends Omit<Phaser.Types.GameObjects.BitmapText.BitmapFontData, 'chars'> {
  chars: Record<number, PixelBitmapFontCharacterData>;
}

/**
 * Pure converter: transforms pixel-font JSON + atlas layout into Phaser 3.90.0 BitmapFontData.
 */
export function buildBitmapFontData(
  fontJson: PixelFontJson,
  layout: PixelAtlasLayout,
): PixelBitmapFontData {
  const chars: Record<number, PixelBitmapFontCharacterData> = {};

  for (const p of layout.placements) {
    const u0 = p.x / layout.width;
    const v0 = p.y / layout.height;
    const u1 = (p.x + p.width) / layout.width;
    const v1 = (p.y + p.height) / layout.height;

    chars[p.charCode] = {
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      centerX: Math.floor(p.width / 2),
      centerY: Math.floor(p.height / 2),
      xOffset: p.glyph.xoffset ?? 0,
      yOffset: p.glyph.yoffset ?? 0,
      xAdvance: p.glyph.advance,
      data: {},
      kerning: {},
      u0,
      v0,
      u1,
      v1,
    };
  }

  return {
    font: fontJson.font,
    size: fontJson.size,
    lineHeight: fontJson.lineHeight ?? fontJson.size,
    retroFont: false,
    chars,
  };
}

/**
 * Wraps CJK/mixed text into lines that fit within `maxPx` at `size` px.
 * Needed because Phaser BitmapText maxWidth wraps only on spaces.
 */
export function wrapPixelText(
  text: string,
  maxPx: number,
  size: 12 | 24 | 48 = 24,
  fontJson: PixelFontJson = PIXEL_FONT_DATA,
): string {
  const scale = size / fontJson.size;
  const paragraphs = text.split('\n');
  const wrappedLines: string[] = [];

  for (const para of paragraphs) {
    let line = '';
    let lineWidth = 0;

    const tokens = para.match(/\+?\d+%?|[\s\S]/gu) ?? [];
    for (const token of tokens) {
      let adv = 0;
      for (const ch of token) {
        adv += (fontJson.glyphs[ch]?.advance ?? fontJson.size) * scale;
      }
      if (line.length > 0 && lineWidth + adv > maxPx) {
        wrappedLines.push(line.trimEnd());
        if (token === ' ') {
          line = '';
          lineWidth = 0;
          continue;
        }
        line = token;
        lineWidth = adv;
      } else {
        line += token;
        lineWidth += adv;
      }
    }

    if (line.length > 0 || para.length === 0) {
      wrappedLines.push(line.trimEnd());
    }
  }

  return wrappedLines.join('\n');
}

function formatHexTint(tint: number): string {
  return `#${(tint & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
}

function ensureColoredPixelFont(
  scene: Phaser.Scene,
  fontKey: string,
  textureKey: string,
  fillHex: string,
  fontJson: PixelFontJson = PIXEL_FONT_DATA,
): void {
  if (scene.cache.bitmapFont.exists(fontKey)) {
    return;
  }

  const layout = computeAtlasLayout(fontJson);
  const data = buildBitmapFontData(fontJson, layout);

  if (!scene.textures.exists(textureKey)) {
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D context for pixel font atlas');
    }

    ctx.clearRect(0, 0, layout.width, layout.height);
    ctx.fillStyle = fillHex;

    for (const p of layout.placements) {
      const { rows } = p.glyph;
      for (let ry = 0; ry < rows.length; ry += 1) {
        const row = rows[ry];
        for (let rx = 0; rx < row.length; rx += 1) {
          if (row[rx] === '1') {
            ctx.fillRect(p.x + rx, p.y + ry, 1, 1);
          }
        }
      }
    }

    const texture = scene.textures.addCanvas(textureKey, canvas);
    // Phaser.Textures.FilterMode.NEAREST === 1
    texture?.setFilter(1);
  }

  scene.cache.bitmapFont.add(fontKey, {
    data,
    texture: textureKey,
    frame: '__BASE',
    fromAtlas: false,
  });
}

function isCanvasRenderer(scene: Phaser.Scene): boolean {
  // Phaser.CANVAS === 1; Phaser.WEBGL === 2
  const renderer = scene.game?.renderer as { type?: number } | undefined;
  return renderer?.type === 1;
}

/**
 * Generates the white-pixel bitmap font atlas on an in-memory canvas and registers it
 * into Phaser's texture & bitmapFont caches (idempotent).
 */
export function loadPixelFont(
  scene: Phaser.Scene,
  fontJson: PixelFontJson = PIXEL_FONT_DATA,
): void {
  ensureColoredPixelFont(scene, PIXEL_FONT_KEY, PIXEL_FONT_TEXTURE_KEY, '#FFFFFF', fontJson);
}

/**
 * Helper to create crisp pixel BitmapText tinted to the 16-color palette.
 * In Canvas2D mode (where Phaser BitmapText ignores setTint), transparently uses
 * pre-baked palette-colored 1-bit atlases and wraps setTint() to swap atlases.
 */
export function addPixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: PixelTextOptions = {},
): Phaser.GameObjects.BitmapText {
  loadPixelFont(scene);

  const size = opts.size ?? 24;
  const align = opts.align ?? 0;
  const canvasMode = isCanvasRenderer(scene);
  const initialTint =
    opts.color !== undefined
      ? typeof opts.color === 'number'
        ? opts.color
        : parseHexColor(opts.color)
      : undefined;

  let initialFontKey = PIXEL_FONT_KEY;
  if (canvasMode && initialTint !== undefined) {
    const hex = formatHexTint(initialTint);
    initialFontKey = `${PIXEL_FONT_KEY}-${hex.slice(1)}`;
    ensureColoredPixelFont(scene, initialFontKey, `${PIXEL_FONT_TEXTURE_KEY}-${hex.slice(1)}`, hex);
  }

  const bmText = scene.add.bitmapText(Math.round(x), Math.round(y), initialFontKey, text, size, align);

  if (canvasMode) {
    const origSetTint = bmText.setTint.bind(bmText);
    bmText.setTint = ((topLeft?: number, topRight?: number, bottomLeft?: number, bottomRight?: number) => {
      if (typeof topLeft === 'number') {
        const hex = formatHexTint(topLeft);
        const key = `${PIXEL_FONT_KEY}-${hex.slice(1)}`;
        ensureColoredPixelFont(scene, key, `${PIXEL_FONT_TEXTURE_KEY}-${hex.slice(1)}`, hex);
        bmText.setFont(key, bmText.fontSize, bmText.align);
      }
      return origSetTint(topLeft, topRight, bottomLeft, bottomRight);
    }) as typeof bmText.setTint;
  }

  if (initialTint !== undefined) {
    bmText.setTint(initialTint);
  }

  if (opts.origin !== undefined) {
    if (typeof opts.origin === 'number') {
      bmText.setOrigin(opts.origin);
    } else {
      bmText.setOrigin(opts.origin[0], opts.origin[1]);
    }
  }

  if (opts.lineSpacing !== undefined) {
    bmText.setLineSpacing(opts.lineSpacing);
  }

  return bmText;
}
