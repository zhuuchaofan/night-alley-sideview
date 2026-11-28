import { describe, expect, it } from 'vitest';
import { PIXEL_FONT_DATA } from '../../src/game/pixelFont.ts';
import { ROOM_TEMPLATES } from '../../src/game/rooms.ts';

describe('pixel font coverage for S2 labels', () => {
  it('every character used in room labels, door labels and banners exists', () => {
    // S2 切片 (a) 新加或改动的全部界面文本: 模板 label (房间横幅与分支门标),
    // 单门「继续前进」、商店柜台、房间横幅格式 (夜巷 i/n · label)、结算提示。
    const strings = [
      ...ROOM_TEMPLATES.map((t) => t.label),
      '继续前进',
      '柜台',
      '大心魔 · 狂暴',
      '狂暴',
      // 房间横幅按实际骨架枚举全部房号 (夜巷 i/5), 不只抽查 1/5。
      ...[1, 2, 3, 4, 5].map((i) => `夜巷 ${i}/5 · 入口 · 夜巷`),
      'R 重试本局 · Esc 返回标题',
    ];
    const missing = new Set<string>();
    for (const s of strings) {
      for (const ch of s) {
        if (ch === ' ') {
          continue;
        }
        if (!PIXEL_FONT_DATA.glyphs[ch]) {
          missing.add(ch);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });
});
