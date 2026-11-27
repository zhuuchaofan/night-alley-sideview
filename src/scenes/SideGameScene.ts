import Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ENEMY_BASE_HP,
  ENEMY_BASE_SPEED,
  ENEMY_CONTACT_DAMAGE,
  HUD_HEIGHT,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  SIDE_CHARGE_THRESHOLD,
  SIDE_COIN_PICKUP_RADIUS,
  SIDE_DASH_COOLDOWN,
  SIDE_DASH_DAMAGE,
  SIDE_DASH_DURATION,
  SIDE_DASH_SPEED,
  SIDE_ENEMY_CONTACT_COOLDOWN,
  SIDE_GROUND_Y,
  SIDE_HEAVY_DAMAGE,
  SIDE_HEAVY_HEIGHT,
  SIDE_HEAVY_HITSTOP_MS,
  SIDE_HEAVY_KNOCKBACK,
  SIDE_HEAVY_WIDTH,
  SIDE_INITIAL_ENEMIES,
  SIDE_JUMP_VELOCITY,
  SIDE_ROLL_COOLDOWN,
  SIDE_ROLL_DURATION,
  SIDE_ROLL_SPEED,
  SIDE_SWING_COOLDOWN,
  SIDE_SWING_DAMAGE,
  SIDE_SWING_HEIGHT,
  SIDE_SWING_KNOCKBACK,
  SIDE_SWING_WIDTH,
  SIDE_WALL_WIDTH,
} from '../game/balance.ts';
import { addPixelText } from '../game/pixelFont.ts';
import { buildNightAlleyBackdrop, ensureGameTextures, PALETTE } from '../game/pixelart.ts';
import { registerSideDebugHook } from '../game/sideDebug.ts';
import { playSound } from '../game/sound.ts';

interface EnemyUnit {
  id: number;
  sprite: Phaser.Physics.Arcade.Sprite;
  hp: number;
  contactCooldown: number;
  stunTimer: number;
  flashTimer: number;
}

interface CoinDrop {
  sprite: Phaser.Physics.Arcade.Image;
}

export class SideGameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private enemies: EnemyUnit[] = [];
  private coinDrops: CoinDrop[] = [];
  private nextEnemyId = 1;

  private hp = PLAYER_MAX_HP;
  private kills = 0;
  private coins = 0;
  private roomCleared = false;
  private gameOverTriggered = false;

  private facing: 1 | -1 = 1;
  private walkTimer = 0;
  private walkFrame = false;

  private swingCooldown = 0;
  private swingVisualTimer = 0;
  private jHeld = false;
  private jHoldStartMs = 0;

  private rollTimer = 0;
  private rollCooldown = 0;
  private rollDir: 1 | -1 = 1;
  private rollActiveThisFrame = false;
  private rollJustEnded = false;

  private dashTimer = 0;
  private dashCooldown = 0;
  private dashDir: 1 | -1 = 1;
  private dashHitIds = new Set<number>();
  private dashCleanupPending = false;

  private playerFlashTimer = 0;
  private screenFlash!: Phaser.GameObjects.Rectangle;

  private chargeBg!: Phaser.GameObjects.Rectangle;
  private chargeFill!: Phaser.GameObjects.Rectangle;
  private chargeLabel!: Phaser.GameObjects.BitmapText;

  private hpText!: Phaser.GameObjects.BitmapText;
  private enemiesText!: Phaser.GameObjects.BitmapText;
  private coinsText!: Phaser.GameObjects.BitmapText;
  private rollHudText!: Phaser.GameObjects.BitmapText;
  private dashHudText!: Phaser.GameObjects.BitmapText;

  private clearGroup!: Phaser.GameObjects.Group;
  private clearCoinsText!: Phaser.GameObjects.BitmapText;

  private keyA!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyLeft!: Phaser.Input.Keyboard.Key;
  private keyRight!: Phaser.Input.Keyboard.Key;
  private keyK!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyJ!: Phaser.Input.Keyboard.Key;
  private keyShift!: Phaser.Input.Keyboard.Key;
  private keyL!: Phaser.Input.Keyboard.Key;

  constructor() {
    super('SideGameScene');
  }

  create(): void {
    this.resetState();
    ensureGameTextures(this);
    buildNightAlleyBackdrop(this, 0);

    this.physics.world.setBounds(
      SIDE_WALL_WIDTH,
      HUD_HEIGHT,
      ARENA_WIDTH - SIDE_WALL_WIDTH * 2,
      ARENA_HEIGHT - HUD_HEIGHT,
    );

    this.createRoomGeometry();
    this.createPlayer();
    this.createHud();
    this.createClearBanner();
    this.bindInputs();

    const spawnXs = [460, 560, 660, 760, 840];
    for (let i = 0; i < SIDE_INITIAL_ENEMIES; i += 1) {
      this.spawnEnemy(spawnXs[i % spawnXs.length], SIDE_GROUND_Y - 32);
    }
    this.updateHud();

    registerSideDebugHook({
      getState: () => ({
        scene: 'SideGameScene',
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
        hp: this.hp,
        kills: this.kills,
        coins: this.coins,
        enemiesAlive: this.enemies.length,
        roomCleared: this.roomCleared,
      }),
      spawnEnemyNearPlayer: () => {
        if (this.gameOverTriggered) {
          return;
        }
        const preferredX = this.player.x + this.facing * 38;
        const minX = SIDE_WALL_WIDTH + 24;
        const maxX = ARENA_WIDTH - SIDE_WALL_WIDTH - 24;
        const spawnX =
          preferredX >= minX && preferredX <= maxX
            ? preferredX
            : Phaser.Math.Clamp(this.player.x - this.facing * 38, minX, maxX);
        this.spawnEnemy(spawnX, this.player.y);
        if (this.roomCleared) {
          this.roomCleared = false;
          this.clearGroup.setVisible(false);
        }
        this.updateHud();
      },
      setHp: (nextHp: number) => {
        if (this.gameOverTriggered) {
          return;
        }
        this.hp = Math.max(0, Math.min(PLAYER_MAX_HP, nextHp));
        this.updateHud();
        if (this.hp <= 0) {
          this.triggerGameOver();
        }
      },
    });
  }

  private resetState(): void {
    this.enemies = [];
    this.coinDrops = [];
    this.nextEnemyId = 1;
    this.hp = PLAYER_MAX_HP;
    this.kills = 0;
    this.coins = 0;
    this.roomCleared = false;
    this.gameOverTriggered = false;
    this.facing = 1;
    this.walkTimer = 0;
    this.walkFrame = false;
    this.swingCooldown = 0;
    this.swingVisualTimer = 0;
    this.jHeld = false;
    this.jHoldStartMs = 0;
    this.rollTimer = 0;
    this.rollCooldown = 0;
    this.rollActiveThisFrame = false;
    this.rollJustEnded = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashCleanupPending = false;
    this.dashHitIds.clear();
    this.playerFlashTimer = 0;
  }

  private createRoomGeometry(): void {
    this.platforms = this.physics.add.staticGroup();

    // Ground: top at y = 500
    const ground = this.add.rectangle(ARENA_WIDTH / 2, SIDE_GROUND_Y + 20, ARENA_WIDTH, 40, 0x2e2118).setDepth(4);
    this.add.rectangle(ARENA_WIDTH / 2, SIDE_GROUND_Y + 2, ARENA_WIDTH, 4, 0x8a5a33).setDepth(5);
    this.platforms.add(ground);

    // 2 static one-way platforms (heights y=412 and y=324, within single-jump reach 96px)
    this.addPlatform(300, 420, 240, 16);
    this.addPlatform(620, 332, 240, 16);
  }

  private addPlatform(x: number, y: number, w: number, h: number): void {
    const plat = this.add.rectangle(x, y, w, h, 0x5a3a22).setStrokeStyle(2, 0xc9973f).setDepth(4);
    this.platforms.add(plat);
    const body = plat.body as Phaser.Physics.Arcade.StaticBody;
    body.checkCollision.down = false;
    body.checkCollision.left = false;
    body.checkCollision.right = false;
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(180, SIDE_GROUND_Y - 32, 'player_idle').setDepth(8);
    this.player.setCollideWorldBounds(true);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(28, 48).setOffset(18, 6);

    this.physics.add.collider(this.player, this.platforms);

    this.chargeBg = this.add.rectangle(0, 0, 44, 6, 0x17120c).setDepth(15).setVisible(false);
    this.chargeFill = this.add
      .rectangle(0, 0, 40, 4, 0xc9973f)
      .setOrigin(0, 0.5)
      .setDepth(16)
      .setVisible(false);
    this.chargeLabel = addPixelText(this, 0, 0, '蓄力', {
      size: 12,
      color: PALETTE.candleLight,
      origin: 0.5,
    })
      .setDepth(16)
      .setVisible(false);

    this.screenFlash = this.add
      .rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, ARENA_WIDTH, ARENA_HEIGHT, 0xb03a2e, 0.25)
      .setDepth(30)
      .setAlpha(0);
  }

  private createHud(): void {
    this.add.rectangle(ARENA_WIDTH / 2, HUD_HEIGHT / 2, ARENA_WIDTH, HUD_HEIGHT, 0x10182b, 0.92).setDepth(20);
    this.add.rectangle(ARENA_WIDTH / 2, HUD_HEIGHT, ARENA_WIDTH, 2, 0xc9973f).setDepth(20);

    this.hpText = addPixelText(this, 20, 22, '', { size: 24, color: PALETTE.paperWhite, origin: [0, 0.5] }).setDepth(21);
    this.enemiesText = addPixelText(this, 200, 22, '', { size: 24, color: PALETTE.vermilion, origin: [0, 0.5] }).setDepth(21);
    this.coinsText = addPixelText(this, 340, 22, '', { size: 24, color: PALETTE.lanternYellow, origin: [0, 0.5] }).setDepth(21);
    this.rollHudText = addPixelText(this, 490, 22, '', { size: 24, color: PALETTE.silverBlue, origin: [0, 0.5] }).setDepth(21);
    this.dashHudText = addPixelText(this, 680, 22, '', { size: 24, color: PALETTE.oldPaper, origin: [0, 0.5] }).setDepth(21);
  }

  private createClearBanner(): void {
    const panel = this.add
      .rectangle(ARENA_WIDTH / 2, 220, 480, 190, 0x1b2a4a, 0.95)
      .setStrokeStyle(3, 0xe8b34b)
      .setDepth(25);
    const title = addPixelText(this, ARENA_WIDTH / 2, 165, '守夜成功', {
      size: 48,
      color: PALETTE.lanternYellow,
      origin: 0.5,
    }).setDepth(26);
    this.clearCoinsText = addPixelText(this, ARENA_WIDTH / 2, 225, '铜钱总数：0', {
      size: 24,
      color: PALETTE.candleLight,
      origin: 0.5,
    }).setDepth(26);
    const hint = addPixelText(this, ARENA_WIDTH / 2, 272, '按 R 重开 · Esc 回标题', {
      size: 24,
      color: PALETTE.silverBlue,
      origin: 0.5,
    }).setDepth(26);

    this.clearGroup = this.add.group([panel, title, this.clearCoinsText, hint]);
    this.clearGroup.setVisible(false);
  }

  private bindInputs(): void {
    const kb = this.input.keyboard;
    if (!kb) {
      return;
    }

    this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyLeft = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keyRight = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.keyK = kb.addKey(Phaser.Input.Keyboard.KeyCodes.K);
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyJ = kb.addKey(Phaser.Input.Keyboard.KeyCodes.J);
    this.keyShift = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyL = kb.addKey(Phaser.Input.Keyboard.KeyCodes.L);

    const onKeyDownJ = (event: KeyboardEvent): void => {
      if (this.gameOverTriggered || this.rollTimer > 0 || this.dashTimer > 0 || this.jHeld) {
        return;
      }
      this.jHeld = true;
      // Charge is judged on the DOM event timestamps, not the scene clock:
      // this.time.now only advances once per frame, so a hold just past the
      // threshold could otherwise be under-read by up to a frame (more under
      // hitching). event.timeStamp shares performance.now()'s time origin.
      this.jHoldStartMs = event.timeStamp;
    };

    const onKeyUpJ = (event: KeyboardEvent): void => {
      if (!this.jHeld || this.gameOverTriggered) {
        this.jHeld = false;
        return;
      }
      this.releaseSwordAttack(event.timeStamp - this.jHoldStartMs);
    };

    const onRestart = (): void => {
      if (this.roomCleared) {
        this.scene.restart();
      }
    };

    const onEscape = (): void => {
      if (this.roomCleared) {
        this.scene.start('TitleScene');
      }
    };

    kb.on('keydown-J', onKeyDownJ);
    kb.on('keyup-J', onKeyUpJ);
    kb.on('keydown-R', onRestart);
    kb.on('keydown-ESC', onEscape);

    const cleanup = (): void => {
      this.events.off(Phaser.Scenes.Events.DESTROY, cleanup);
      kb.off('keydown-J', onKeyDownJ);
      kb.off('keyup-J', onKeyUpJ);
      kb.off('keydown-R', onRestart);
      kb.off('keydown-ESC', onEscape);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
  }

  private spawnEnemy(x: number, y: number): void {
    const sprite = this.physics.add.sprite(x, y, 'enemy_paper').setDepth(7);
    sprite.setCollideWorldBounds(true);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(28, 46).setOffset(18, 8);
    this.physics.add.collider(sprite, this.platforms);

    this.enemies.push({
      id: this.nextEnemyId++,
      sprite,
      hp: ENEMY_BASE_HP,
      contactCooldown: 0,
      stunTimer: 0,
      flashTimer: 0,
    });
  }

  private releaseSwordAttack(heldMs?: number): void {
    // Charge is judged on real elapsed time between the key events, not on
    // accumulated frame deltas, so a hold just past the threshold cannot be
    // under-read by up to two frames (or more under hitching, where dt is
    // clamped to 50ms per frame). Callers pass the event-timestamp delta
    // when one exists; the update-loop fallback uses performance.now().
    const held = heldMs ?? performance.now() - this.jHoldStartMs;
    this.jHeld = false;
    this.jHoldStartMs = 0;
    this.hideChargeBar();

    if (this.rollTimer > 0 || this.dashTimer > 0) {
      return;
    }

    if (held >= SIDE_CHARGE_THRESHOLD * 1000) {
      this.performSwordStrike(true);
    } else if (this.swingCooldown <= 0) {
      this.performSwordStrike(false);
    }
  }

  private performSwordStrike(isHeavy: boolean): void {
    this.swingCooldown = SIDE_SWING_COOLDOWN;
    this.swingVisualTimer = isHeavy ? 0.22 : 0.16;
    playSound('swing');

    const width = isHeavy ? SIDE_HEAVY_WIDTH : SIDE_SWING_WIDTH;
    const height = isHeavy ? SIDE_HEAVY_HEIGHT : SIDE_SWING_HEIGHT;
    const damage = isHeavy ? SIDE_HEAVY_DAMAGE : SIDE_SWING_DAMAGE;
    const knockback = isHeavy ? SIDE_HEAVY_KNOCKBACK : SIDE_SWING_KNOCKBACK;
    const stunDuration = isHeavy ? 0.35 : 0.16;

    const hitCenterX = this.player.x + this.facing * (width * 0.52);
    const hitCenterY = this.player.y;
    const hitbox = new Phaser.Geom.Rectangle(
      hitCenterX - width / 2,
      hitCenterY - height / 2,
      width,
      height,
    );

    const slashTex = isHeavy ? 'slash_arc_evolved' : 'slash_arc';
    const slash = this.add
      .image(hitCenterX, hitCenterY, slashTex)
      .setFlipX(this.facing < 0)
      .setDisplaySize(width, height)
      .setDepth(12);
    this.tweens.add({
      targets: slash,
      alpha: 0,
      scaleX: slash.scaleX * 1.15,
      duration: isHeavy ? 180 : 120,
      onComplete: () => slash.destroy(),
    });

    let hitCount = 0;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      const eBounds = enemy.sprite.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(hitbox, eBounds)) {
        hitCount += 1;
        const dir = enemy.sprite.x >= this.player.x ? 1 : -1;
        this.damageEnemy(enemy, i, damage, dir * knockback, isHeavy ? -90 : -40, stunDuration);
      }
    }

    if (hitCount > 0) {
      playSound('hit');
      if (isHeavy) {
        this.physics.world.pause();
        this.cameras.main.shake(110, 0.008);
        this.time.delayedCall(SIDE_HEAVY_HITSTOP_MS, () => {
          if (this.scene.isActive()) {
            this.physics.world.resume();
          }
        });
      }
    }
  }

  private damageEnemy(
    enemy: EnemyUnit,
    index: number,
    damage: number,
    knockX: number,
    knockY: number,
    stunDuration: number,
  ): void {
    enemy.hp -= damage;
    enemy.stunTimer = stunDuration;
    enemy.flashTimer = 0.1;
    enemy.sprite.setTexture('enemy_paper_hit');

    const body = enemy.sprite.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(knockX, knockY);

    this.spawnFloatingNumber(enemy.sprite.x, enemy.sprite.y - 24, `-${damage}`, PALETTE.lanternYellow);

    if (enemy.hp <= 0) {
      this.killEnemy(enemy, index);
    }
  }

  private killEnemy(enemy: EnemyUnit, index: number): void {
    const ex = enemy.sprite.x;
    const ey = enemy.sprite.y;
    enemy.sprite.destroy();
    this.enemies.splice(index, 1);

    this.kills += 1;
    playSound('kill');
    this.spawnDeathBurst(ex, ey);
    this.spawnCoinDrop(ex, ey);

    if (this.enemies.length === 0 && !this.roomCleared) {
      this.roomCleared = true;
      this.clearCoinsText.setText(`铜钱总数：${this.coins}`);
      this.clearGroup.setVisible(true);
    }
    this.updateHud();
  }

  private spawnDeathBurst(x: number, y: number): void {
    for (let i = 0; i < 7; i += 1) {
      const angle = (Math.PI * 2 * i) / 7;
      const dist = 18 + (i % 3) * 8;
      const p = this.add
        .rectangle(x, y, 4, 4, i % 2 === 0 ? 0xfbf6e9 : 0xe8b34b)
        .setDepth(13);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        duration: 240,
        onComplete: () => p.destroy(),
      });
    }
  }

  private spawnCoinDrop(x: number, y: number): void {
    const coin = this.physics.add.image(x, y - 6, 'coin_dart').setDisplaySize(24, 24).setDepth(7);
    coin.setCollideWorldBounds(true);
    coin.setBounce(0.35);
    const body = coin.body as Phaser.Physics.Arcade.Body;
    body.setSize(20, 20);
    body.setVelocity((Math.random() - 0.5) * 60, -180);
    this.physics.add.collider(coin, this.platforms);
    this.coinDrops.push({ sprite: coin });
  }

  private spawnFloatingNumber(x: number, y: number, text: string, color: string): void {
    const label = addPixelText(this, x, y, text, { size: 12, color, origin: 0.5 }).setDepth(18);
    this.tweens.add({
      targets: label,
      y: y - 24,
      alpha: 0,
      duration: 420,
      onComplete: () => label.destroy(),
    });
  }

  private hideChargeBar(): void {
    this.chargeBg.setVisible(false);
    this.chargeFill.setVisible(false);
    this.chargeLabel.setVisible(false);
  }

  private updateHud(): void {
    this.hpText.setText(`生命：${this.hp}/${PLAYER_MAX_HP}`);
    this.enemiesText.setText(`心魔：${this.enemies.length}`);
    this.coinsText.setText(`铜钱：${this.coins}`);
    this.rollHudText.setText(
      this.rollCooldown <= 0 ? '翻身 可用' : `翻身 ${this.rollCooldown.toFixed(1)}s`,
    );
    this.dashHudText.setText(
      this.dashCooldown <= 0 ? '疾攻 可用' : `疾攻 ${this.dashCooldown.toFixed(1)}s`,
    );
    if (this.roomCleared) {
      this.clearCoinsText.setText(`铜钱总数：${this.coins}`);
    }
  }

  private triggerGameOver(): void {
    if (this.gameOverTriggered) {
      return;
    }
    this.gameOverTriggered = true;
    this.scene.start('GameOverScene', {
      kills: this.kills,
      coins: this.coins,
    });
  }

  override update(_time: number, deltaMs: number): void {
    if (this.gameOverTriggered || this.physics.world.isPaused) {
      return;
    }

    const dt = Math.min(deltaMs / 1000, 0.05);
    this.swingCooldown = Math.max(0, this.swingCooldown - dt);
    this.swingVisualTimer = Math.max(0, this.swingVisualTimer - dt);
    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);

    if (this.playerFlashTimer > 0) {
      this.playerFlashTimer = Math.max(0, this.playerFlashTimer - dt);
    }

    const moveInput =
      (this.keyD.isDown || this.keyRight.isDown ? 1 : 0) -
      (this.keyA.isDown || this.keyLeft.isDown ? 1 : 0);

    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Finish the previous frame's dash: its last step has now been consumed
    // by physics, so restore gravity and angle before normal movement sets
    // the velocity. The final hit check runs on POST_UPDATE, after the
    // physics world syncs sprite positions: bounds read in update() still
    // show the pre-final-step positions, so enemies overlapped only at the
    // dash endpoint would otherwise be missed.
    if (this.dashCleanupPending) {
      this.dashCleanupPending = false;
      body.setAllowGravity(true);
      this.player.setAngle(0);
      this.events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
        if (!this.gameOverTriggered) {
          this.checkDashHits();
        }
      });
    }

    // Roll (Shift): defensive dodge with i-frames
    if (
      Phaser.Input.Keyboard.JustDown(this.keyShift) &&
      this.rollCooldown <= 0 &&
      this.rollTimer <= 0 &&
      this.dashTimer <= 0
    ) {
      this.jHeld = false;
      this.hideChargeBar();
      if (moveInput !== 0) {
        this.facing = moveInput > 0 ? 1 : -1;
      }
      this.rollDir = this.facing;
      this.rollTimer = SIDE_ROLL_DURATION;
      this.rollCooldown = SIDE_ROLL_COOLDOWN;
    }

    // Dash Attack (L): offensive lunge piercing enemies
    if (
      Phaser.Input.Keyboard.JustDown(this.keyL) &&
      this.dashCooldown <= 0 &&
      this.dashTimer <= 0 &&
      this.rollTimer <= 0
    ) {
      this.jHeld = false;
      this.hideChargeBar();
      if (moveInput !== 0) {
        this.facing = moveInput > 0 ? 1 : -1;
      }
      this.dashDir = this.facing;
      this.dashTimer = SIDE_DASH_DURATION;
      this.dashCooldown = SIDE_DASH_COOLDOWN;
      this.dashHitIds.clear();
      body.setAllowGravity(false);
      playSound('swing');
    }

    // One roll interval drives both speed and i-frames. The contact check in
    // this update sees positions from the previous physics step (sprites
    // sync in POST_UPDATE), so i-frames must still hold on the first update
    // after the roll timer hits zero: that update's check covers the last
    // roll-speed step. The grace flag is consumed after one update.
    this.rollActiveThisFrame = this.rollTimer > 0 || this.rollJustEnded;
    this.rollJustEnded = false;
    if (this.rollTimer > 0) {
      this.rollTimer = Math.max(0, this.rollTimer - dt);
      if (this.rollTimer === 0) {
        this.rollJustEnded = true;
        this.player.setAlpha(1);
        this.player.setAngle(0);
      }
    }

    if (this.rollTimer > 0) {
      body.setVelocityX(this.rollDir * SIDE_ROLL_SPEED);
      this.player.setAlpha(0.55);
      this.player.setAngle(this.rollDir * 14);
    } else if (this.dashTimer > 0) {
      this.dashTimer = Math.max(0, this.dashTimer - dt);
      body.setVelocity(this.dashDir * SIDE_DASH_SPEED, 0);
      this.player.setAngle(this.dashDir * 8);
      this.checkDashHits();
      if (this.dashTimer === 0) {
        this.dashCleanupPending = true;
      }
    } else {
      if (moveInput !== 0) {
        this.facing = moveInput > 0 ? 1 : -1;
      }
      body.setVelocityX(moveInput * PLAYER_SPEED);

      const jumpPressed =
        Phaser.Input.Keyboard.JustDown(this.keyK) || Phaser.Input.Keyboard.JustDown(this.keySpace);
      if (jumpPressed && body.blocked.down) {
        body.setVelocityY(SIDE_JUMP_VELOCITY);
      }
    }

    this.player.setFlipX(this.facing < 0);

    // Hold-J charge tracking (same real-time basis as releaseSwordAttack)
    if (this.jHeld) {
      if (!this.keyJ.isDown) {
        this.releaseSwordAttack();
      } else {
        const heldMs = performance.now() - this.jHoldStartMs;
        const ratio = Math.min(1, heldMs / (SIDE_CHARGE_THRESHOLD * 1000));
        const barY = this.player.y - 38;
        this.chargeBg.setPosition(this.player.x, barY).setVisible(true);
        this.chargeFill
          .setPosition(this.player.x - 20, barY)
          .setSize(Math.max(2, Math.round(40 * ratio)), 4)
          .setFillStyle(ratio >= 1 ? 0xe8b34b : 0xf2e3c6)
          .setVisible(true);
        this.chargeLabel
          .setPosition(this.player.x, barY - 11)
          .setText(ratio >= 1 ? '蓄满' : '蓄力')
          .setTint(ratio >= 1 ? 0xe8b34b : 0xf2e3c6)
          .setVisible(true);
      }
    }

    this.updatePlayerTexture(moveInput !== 0 && body.blocked.down, dt);
    this.updateEnemies(dt);
    this.updateCoinDrops();
    this.updateHud();
  }

  private checkDashHits(): void {
    const pBounds = this.player.getBounds();
    let hitAny = false;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (this.dashHitIds.has(enemy.id)) {
        continue;
      }
      if (Phaser.Geom.Intersects.RectangleToRectangle(pBounds, enemy.sprite.getBounds())) {
        this.dashHitIds.add(enemy.id);
        hitAny = true;
        this.damageEnemy(enemy, i, SIDE_DASH_DAMAGE, this.dashDir * 100, -40, 0.15);
      }
    }
    if (hitAny) {
      playSound('hit');
    }
  }

  private updatePlayerTexture(walkingOnGround: boolean, dt: number): void {
    if (this.playerFlashTimer > 0) {
      this.player.setTexture('player_hit');
      return;
    }
    if (this.swingVisualTimer > 0 || this.dashTimer > 0) {
      this.player.setTexture(this.swingVisualTimer > 0.08 ? 'player_swing_1' : 'player_swing_2');
      return;
    }
    if (walkingOnGround) {
      this.walkTimer += dt;
      if (this.walkTimer >= 0.14) {
        this.walkTimer = 0;
        this.walkFrame = !this.walkFrame;
      }
      this.player.setTexture(this.walkFrame ? 'player_walk_1' : 'player_walk_2');
      return;
    }
    this.player.setTexture('player_idle');
  }

  private updateEnemies(dt: number): void {
    const invulnerable = this.rollActiveThisFrame;
    const pBounds = this.player.getBounds();

    for (const enemy of this.enemies) {
      enemy.contactCooldown = Math.max(0, enemy.contactCooldown - dt);

      if (enemy.flashTimer > 0) {
        enemy.flashTimer = Math.max(0, enemy.flashTimer - dt);
        if (enemy.flashTimer === 0) {
          enemy.sprite.setTexture('enemy_paper');
        }
      }

      const eBody = enemy.sprite.body as Phaser.Physics.Arcade.Body;
      if (enemy.stunTimer > 0) {
        enemy.stunTimer = Math.max(0, enemy.stunTimer - dt);
        if (enemy.stunTimer === 0) {
          eBody.setVelocityX(0);
        }
      } else {
        const dx = this.player.x - enemy.sprite.x;
        const dir = Math.abs(dx) < 6 ? 0 : dx > 0 ? 1 : -1;
        eBody.setVelocityX(dir * ENEMY_BASE_SPEED);
        if (dir !== 0) {
          enemy.sprite.setFlipX(dir < 0);
        }
      }

      if (
        !invulnerable &&
        enemy.contactCooldown <= 0 &&
        Phaser.Geom.Intersects.RectangleToRectangle(pBounds, enemy.sprite.getBounds())
      ) {
        enemy.contactCooldown = SIDE_ENEMY_CONTACT_COOLDOWN;
        this.applyPlayerDamage(ENEMY_CONTACT_DAMAGE);
        if (this.gameOverTriggered) {
          return;
        }
      }
    }
  }

  private applyPlayerDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    this.playerFlashTimer = 0.14;
    this.screenFlash.setAlpha(0.32);
    this.tweens.add({
      targets: this.screenFlash,
      alpha: 0,
      duration: 180,
    });
    this.spawnFloatingNumber(this.player.x, this.player.y - 28, `-${amount}`, PALETTE.vermilion);
    playSound('hit');

    if (this.hp <= 0) {
      this.triggerGameOver();
    }
  }

  private updateCoinDrops(): void {
    for (let i = this.coinDrops.length - 1; i >= 0; i -= 1) {
      const drop = this.coinDrops[i];
      const dist = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        drop.sprite.x,
        drop.sprite.y,
      );
      if (dist <= SIDE_COIN_PICKUP_RADIUS) {
        drop.sprite.destroy();
        this.coinDrops.splice(i, 1);
        this.coins += 1;
        playSound('levelUp');
      }
    }
  }
}
