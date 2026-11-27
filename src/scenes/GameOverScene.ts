import Phaser from 'phaser';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../game/balance.ts';
import { addPixelText } from '../game/pixelFont.ts';
import { buildNightAlleyBackdrop, ensureGameTextures, PALETTE } from '../game/pixelart.ts';
import { registerSideDebugHook } from '../game/sideDebug.ts';

interface GameOverData {
  kills: number;
  coins: number;
}

export class GameOverScene extends Phaser.Scene {
  private kills = 0;
  private coins = 0;

  constructor() {
    super('GameOverScene');
  }

  init(data?: GameOverData): void {
    this.kills = data?.kills ?? 0;
    this.coins = data?.coins ?? 0;
  }

  create(): void {
    ensureGameTextures(this);
    buildNightAlleyBackdrop(this, 0);

    this.add
      .rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 560, 340, 0x1b2a4a)
      .setStrokeStyle(2, 0xb03a2e)
      .setDepth(10);

    addPixelText(this, ARENA_WIDTH / 2 + 2, 148 + 2, '倒在夜巷', {
      size: 48,
      color: PALETTE.inkBlack,
      origin: 0.5,
    }).setDepth(11);
    addPixelText(this, ARENA_WIDTH / 2, 148, '倒在夜巷', {
      size: 48,
      color: PALETTE.paperWhite,
      origin: 0.5,
    }).setDepth(12);

    addPixelText(this, ARENA_WIDTH / 2, 224, `存活杀敌数：${this.kills}`, {
      size: 24,
      color: PALETTE.candleLight,
      origin: 0.5,
    }).setDepth(11);

    addPixelText(this, ARENA_WIDTH / 2, 266, `铜钱数：${this.coins}`, {
      size: 24,
      color: PALETTE.lanternYellow,
      origin: 0.5,
    }).setDepth(11);

    this.createButton(360, 345, '再来一局', 0x2e2118, 0xe8b34b, () => {
      this.scene.start('SideGameScene');
    });

    this.createButton(600, 345, '返回标题', 0x10182b, 0x8fa8c8, () => {
      this.scene.start('TitleScene');
    });

    addPixelText(this, ARENA_WIDTH / 2, 405, '按 R 重开 · Esc 回标题', {
      size: 24,
      color: PALETTE.silverBlue,
      origin: 0.5,
    }).setDepth(11);

    const kb = this.input.keyboard;
    const onRestart = (): void => {
      this.scene.start('SideGameScene');
    };
    const onEscape = (): void => {
      this.scene.start('TitleScene');
    };
    kb?.on('keydown-R', onRestart);
    kb?.on('keydown-ESC', onEscape);

    const cleanup = (): void => {
      this.events.off(Phaser.Scenes.Events.DESTROY, cleanup);
      kb?.off('keydown-R', onRestart);
      kb?.off('keydown-ESC', onEscape);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);

    registerSideDebugHook({
      getState: () => ({
        scene: 'GameOverScene',
        x: ARENA_WIDTH / 2,
        y: ARENA_HEIGHT / 2,
        hp: 0,
        kills: this.kills,
        coins: this.coins,
        enemiesAlive: 0,
        roomCleared: false,
        damageNumbersShown: 0,
        burstsSpawned: 0,
        hitstopsApplied: 0,
      }),
      spawnEnemyNearPlayer: () => {},
      setHp: () => {},
    });
  }

  private createButton(
    x: number,
    y: number,
    label: string,
    fillColor: number,
    borderColor: number,
    onClick: () => void,
  ): void {
    const rect = this.add
      .rectangle(x, y, 180, 48, fillColor)
      .setStrokeStyle(2, borderColor)
      .setDepth(11)
      .setInteractive({ useHandCursor: true });

    const text = addPixelText(this, x, y, label, {
      size: 24,
      color: PALETTE.paperWhite,
      origin: 0.5,
    }).setDepth(12);

    rect.on('pointerover', () => {
      rect.setFillStyle(0x2e4a73);
      text.setTint(0xe8b34b);
    });
    rect.on('pointerout', () => {
      rect.setFillStyle(fillColor);
      text.setTint(0xfbf6e9);
    });
    rect.on('pointerdown', onClick);
  }
}
