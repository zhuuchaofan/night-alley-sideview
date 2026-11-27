import Phaser from 'phaser';
import { ARENA_WIDTH, PLAYER_MAX_HP } from '../game/balance.ts';
import { startBgm } from '../game/bgm.ts';
import { addPixelText } from '../game/pixelFont.ts';
import { buildNightAlleyBackdrop, ensureGameTextures, PALETTE } from '../game/pixelart.ts';
import { registerSideDebugHook } from '../game/sideDebug.ts';
import { unlockSound } from '../game/sound.ts';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create(): void {
    ensureGameTextures(this);
    buildNightAlleyBackdrop(this, 0);

    this.add.image(190, 300, 'player_idle').setDepth(5);
    this.add.image(770, 300, 'enemy_paper').setFlipX(true).setDepth(5);

    addPixelText(this, ARENA_WIDTH / 2 + 2, 74 + 2, '夜 巷', {
      size: 48,
      color: PALETTE.inkBlack,
      origin: 0.5,
    }).setDepth(10);
    addPixelText(this, ARENA_WIDTH / 2, 74, '夜 巷', {
      size: 48,
      color: PALETTE.paperWhite,
      origin: 0.5,
    }).setDepth(11);

    addPixelText(this, ARENA_WIDTH / 2 + 2, 130 + 2, 'NIGHT ALLEY', {
      size: 48,
      color: PALETTE.inkBlack,
      origin: 0.5,
    }).setDepth(10);
    addPixelText(this, ARENA_WIDTH / 2, 130, 'NIGHT ALLEY', {
      size: 48,
      color: PALETTE.lanternYellow,
      origin: 0.5,
    }).setDepth(11);

    addPixelText(this, ARENA_WIDTH / 2, 182, '1987 · 老城夜巷', {
      size: 24,
      color: PALETTE.oldPaper,
      origin: 0.5,
    }).setDepth(11);

    const startBtn = this.add
      .rectangle(ARENA_WIDTH / 2, 300, 220, 56, 0x2e2118)
      .setStrokeStyle(2, 0xe8b34b)
      .setDepth(10)
      .setInteractive({ useHandCursor: true });

    const startLabel = addPixelText(this, ARENA_WIDTH / 2, 300, '开始守夜', {
      size: 24,
      color: PALETTE.paperWhite,
      origin: 0.5,
    }).setDepth(11);

    this.add
      .rectangle(ARENA_WIDTH / 2, 415, 760, 82, 0x10182b)
      .setStrokeStyle(2, 0x2e4a73)
      .setDepth(10);
    addPixelText(this, ARENA_WIDTH / 2, 395, 'A/D 或方向键移动 · K/空格 跳 · J 挥剑', {
      size: 24,
      color: PALETTE.candleLight,
      origin: 0.5,
    }).setDepth(11);
    addPixelText(this, ARENA_WIDTH / 2, 434, '按住 J 蓄力重击 · Shift 翻身(无敌) · L 疾驰攻击', {
      size: 24,
      color: PALETTE.silverBlue,
      origin: 0.5,
    }).setDepth(11);

    addPixelText(this, ARENA_WIDTH / 2, 492, '点击或回车开始', {
      size: 24,
      color: PALETTE.oldPaper,
      origin: 0.5,
    }).setDepth(11);

    let started = false;
    const startGame = (): void => {
      if (started) {
        return;
      }
      started = true;
      unlockSound();
      startBgm();
      this.scene.start('SideGameScene');
    };

    startBtn.on('pointerover', () => {
      startBtn.setFillStyle(0x5a3a22);
      startLabel.setTint(0xe8b34b);
    });
    startBtn.on('pointerout', () => {
      startBtn.setFillStyle(0x2e2118);
      startLabel.setTint(0xfbf6e9);
    });
    startBtn.on('pointerdown', startGame);

    const kb = this.input.keyboard;
    const onEnter = (event: KeyboardEvent): void => {
      const soundToggle = document.getElementById('sound-toggle');
      if (soundToggle && (event.target === soundToggle || document.activeElement === soundToggle)) {
        return;
      }
      startGame();
    };
    kb?.on('keydown-ENTER', onEnter);

    const cleanup = (): void => {
      this.events.off(Phaser.Scenes.Events.DESTROY, cleanup);
      kb?.off('keydown-ENTER', onEnter);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);

    registerSideDebugHook({
      getState: () => ({
        scene: 'TitleScene',
        x: ARENA_WIDTH / 2,
        y: 270,
        hp: PLAYER_MAX_HP,
        kills: 0,
        coins: 0,
        enemiesAlive: 0,
        roomCleared: false,
      }),
      spawnEnemyNearPlayer: () => {},
      setHp: () => {},
    });
  }
}
