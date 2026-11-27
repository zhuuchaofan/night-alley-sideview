import Phaser from 'phaser';
import { ARENA_HEIGHT, ARENA_WIDTH, SIDE_GRAVITY } from './game/balance.ts';
import { bindSoundToggle } from './game/bgm.ts';
import { GameOverScene } from './scenes/GameOverScene.ts';
import { SideGameScene } from './scenes/SideGameScene.ts';
import { TitleScene } from './scenes/TitleScene.ts';

bindSoundToggle();

new Phaser.Game({
  type: Phaser.CANVAS,
  parent: 'game-container',
  width: ARENA_WIDTH,
  height: ARENA_HEIGHT,
  backgroundColor: '#10182B',
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  audio: { noAudio: true },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: SIDE_GRAVITY },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [TitleScene, SideGameScene, GameOverScene],
});
