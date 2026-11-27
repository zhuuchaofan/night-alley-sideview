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
  SIDE_HEAVY_WIDTH,
  SIDE_INITIAL_ENEMIES,
  SIDE_JUMP_VELOCITY,
  SIDE_ROLL_COOLDOWN,
  SIDE_ROLL_DURATION,
  SIDE_ROLL_SPEED,
  SIDE_SWING_COOLDOWN,
  SIDE_SWING_DAMAGE,
  SIDE_SWING_HEIGHT,
  SIDE_SWING_WIDTH,
  SIDE_WALL_WIDTH,
} from '../game/balance.ts';
import { addPixelText } from '../game/pixelFont.ts';
import { buildNightAlleyBackdrop, ensureGameTextures, PALETTE } from '../game/pixelart.ts';
import {
  applySideKnockbackImpulse,
  canMergeSideDamageNumber,
  compensatePlayerBodyScale,
  computeSideCoinScatterOffset,
  computeSideCoinScatterVelocity,
  decaySideKnockbackOffset,
  formatSideDamageNumber,
  SIDE_AFTERIMAGE_INTERVAL_SECONDS,
  SIDE_AFTERIMAGE_LIFETIME_MS,
  SIDE_DAMAGE_NUMBER_DURATION_MS,
  SIDE_DAMAGE_NUMBER_MAX_MERGED_LIFE,
  SIDE_DAMAGE_NUMBER_RISE_PX,
  SIDE_DASH_AFTERIMAGE_ALPHA,
  SIDE_DASH_AFTERIMAGE_STRETCH_X,
  SIDE_HIT_FLASH_SECONDS,
  SIDE_HURT_SHAKE_INTENSITY,
  SIDE_HURT_SHAKE_MS,
  SIDE_KILL_SHAKE_INTENSITY,
  SIDE_KILL_SHAKE_MS,
  SIDE_LIGHT_HITSTOP_MS,
  SIDE_MAX_DAMAGE_NUMBERS,
  SIDE_PLAYER_BODY_HEIGHT,
  SIDE_PLAYER_BODY_OFFSET_X,
  SIDE_PLAYER_BODY_OFFSET_Y,
  SIDE_PLAYER_BODY_WIDTH,
  SIDE_ROLL_AFTERIMAGE_ALPHA,
  SIDE_SQUASH_CROUCH,
  SIDE_SQUASH_CROUCH_SECONDS,
  SIDE_SQUASH_LAND,
  SIDE_SQUASH_LAND_SECONDS,
  SIDE_SQUASH_STRETCH,
  SIDE_SQUASH_STRETCH_SECONDS,
} from '../game/sideFeel.ts';
import { registerSideDebugHook } from '../game/sideDebug.ts';
import { playSound } from '../game/sound.ts';

interface EnemyUnit {
  id: number;
  sprite: Phaser.Physics.Arcade.Sprite;
  hp: number;
  contactCooldown: number;
  stunTimer: number;
  flashTimer: number;
  /** Render-only knockback offset (px); the body never moves with a hit. */
  knockX: number;
  knockY: number;
  /**
   * Offset actually shifted onto the sprite at the last POST_UPDATE.
   * Restore subtracts exactly this (not the live knockX/Y, which the dash
   * POST_UPDATE check can change after the shift was applied).
   */
  appliedKnockX: number;
  appliedKnockY: number;
}

interface CoinDrop {
  /** Non-physics image; the logical position never moves during the scatter. */
  sprite: Phaser.GameObjects.Image;
  logicalX: number;
  logicalY: number;
  scatterVx: number;
  scatterVy: number;
  scatterHopPeak: number;
  scatterTimer: number;
  scatterMax: number;
}

interface DamageNumberEntry {
  enemyId: number;
  label: Phaser.GameObjects.BitmapText;
  amount: number;
  sinceLastHit: number;
  totalLife: number;
}

export class SideGameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private enemies: EnemyUnit[] = [];
  private coinDrops: CoinDrop[] = [];
  private damageNumbers: DamageNumberEntry[] = [];
  private nextEnemyId = 1;

  private hp = PLAYER_MAX_HP;
  private kills = 0;
  private coins = 0;
  private roomCleared = false;
  private gameOverTriggered = false;

  /** Game-feel counters exposed on the debug hook for E2E assertions. */
  private damageNumbersShown = 0;
  private burstsSpawned = 0;
  private hitstopsApplied = 0;

  /** Active hitstop resume timer; replaced (not stacked) when extended. */
  private hitstopEvent?: Phaser.Time.TimerEvent;
  /** Afterimage / speed-line spawn timers during roll and dash. */
  private afterimageTimer = 0;
  private speedLineTimer = 0;
  /** Landing detection: airborne state on the previous frame. */
  private wasAirborne = false;
  /** Squash & stretch phase machine (null = no squash, scale 1). */
  private squashPhase: 'crouch' | 'stretch' | 'land' | null = null;
  private squashTimer = 0;

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
        damageNumbersShown: this.damageNumbersShown,
        burstsSpawned: this.burstsSpawned,
        hitstopsApplied: this.hitstopsApplied,
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
    this.damageNumbers = [];
    this.nextEnemyId = 1;
    this.hp = PLAYER_MAX_HP;
    this.kills = 0;
    this.coins = 0;
    this.roomCleared = false;
    this.gameOverTriggered = false;
    this.damageNumbersShown = 0;
    this.burstsSpawned = 0;
    this.hitstopsApplied = 0;
    this.hitstopEvent = undefined;
    this.afterimageTimer = 0;
    this.speedLineTimer = 0;
    this.wasAirborne = false;
    this.squashPhase = null;
    this.squashTimer = 0;
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
    body
      .setSize(SIDE_PLAYER_BODY_WIDTH, SIDE_PLAYER_BODY_HEIGHT)
      .setOffset(SIDE_PLAYER_BODY_OFFSET_X, SIDE_PLAYER_BODY_OFFSET_Y);

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
      this.events.off(Phaser.Scenes.Events.PRE_RENDER, this.applyRenderOffsets, this);
      this.events.off(Phaser.Scenes.Events.RENDER, this.restoreRenderOffsets, this);
      kb.off('keydown-J', onKeyDownJ);
      kb.off('keyup-J', onKeyUpJ);
      kb.off('keydown-R', onRestart);
      kb.off('keydown-ESC', onEscape);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);

    // Render-only enemy knockback offsets are shifted onto sprites just
    // before the scene is drawn (PRE_RENDER) and restored right after
    // (RENDER), so the shift exists only for the render itself: no gameplay
    // read and no Body.preUpdate ever sees a shifted sprite, and the
    // physics body never moves with a hit. Pairing the hooks around the
    // render also keeps the final dash POST_UPDATE check unshifted.
    this.events.on(Phaser.Scenes.Events.PRE_RENDER, this.applyRenderOffsets, this);
    this.events.on(Phaser.Scenes.Events.RENDER, this.restoreRenderOffsets, this);
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
      knockX: 0,
      knockY: 0,
      appliedKnockX: 0,
      appliedKnockY: 0,
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
    // The arc sweeps through the swing instead of sitting still: same
    // world-space sweep in both facings (the flip mirrors the rotation).
    const sweepMs = isHeavy ? 180 : 120;
    slash.setAngle(-28 * this.facing);
    this.tweens.add({
      targets: slash,
      alpha: 0,
      angle: 28 * this.facing,
      scaleX: slash.scaleX * 1.15,
      duration: sweepMs,
      onComplete: () => slash.destroy(),
    });

    let hitCount = 0;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (Phaser.Geom.Intersects.RectangleToRectangle(hitbox, this.bodyBounds(enemy.sprite))) {
        hitCount += 1;
        const eBody = enemy.sprite.body as Phaser.Physics.Arcade.Body;
        const dir = eBody.center.x >= this.player.x ? 1 : -1;
        this.damageEnemy(enemy, i, damage, dir, isHeavy, stunDuration);
      }
    }

    if (hitCount > 0) {
      playSound('hit');
      // Every sword hit stops the world briefly; heavy keeps its 90ms stop
      // and its shake. A new hit extends the stop instead of stacking one.
      this.applyHitstop(isHeavy ? SIDE_HEAVY_HITSTOP_MS : SIDE_LIGHT_HITSTOP_MS);
      if (isHeavy) {
        // Force: a lethal heavy hit already started the smaller kill shake
        // inside killEnemy, and Phaser drops a shake request while one is
        // running unless force is true.
        this.cameras.main.shake(110, 0.008, true);
      }
    }
  }

  /** Freezes the physics world for `ms`; a new hitstop extends the running one. */
  private applyHitstop(ms: number): void {
    if (this.hitstopEvent) {
      this.hitstopEvent.remove(false);
    }
    this.hitstopsApplied += 1;
    this.physics.world.pause();
    this.hitstopEvent = this.time.delayedCall(ms, () => {
      this.hitstopEvent = undefined;
      if (this.scene.isActive()) {
        this.physics.world.resume();
      }
    });
  }

  /** Logical (physics-body) bounds of a sprite — never the shifted visual. */
  private bodyBounds(sprite: Phaser.Physics.Arcade.Sprite): Phaser.Geom.Rectangle {
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    return new Phaser.Geom.Rectangle(body.position.x, body.position.y, body.width, body.height);
  }

  private damageEnemy(
    enemy: EnemyUnit,
    index: number,
    damage: number,
    dirX: number,
    isHeavy: boolean,
    stunDuration: number,
  ): void {
    enemy.hp -= damage;
    enemy.stunTimer = stunDuration;
    enemy.flashTimer = SIDE_HIT_FLASH_SECONDS;
    enemy.sprite.setTexture('enemy_paper_hit');

    // Knockback is render-only: the body freezes in place for the stun
    // (velocity zeroed) and only the visual offset moves, decaying back.
    const body = enemy.sprite.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    const kb = applySideKnockbackImpulse(enemy.knockX, enemy.knockY, dirX, isHeavy);
    enemy.knockX = kb.x;
    enemy.knockY = kb.y;

    this.spawnDamageNumber(enemy, damage);

    if (enemy.hp <= 0) {
      this.killEnemy(enemy, index);
    }
  }

  private killEnemy(enemy: EnemyUnit, index: number): void {
    const body = enemy.sprite.body as Phaser.Physics.Arcade.Body;
    const ex = body.center.x;
    const ey = body.center.y;
    enemy.sprite.destroy();
    this.enemies.splice(index, 1);

    this.kills += 1;
    playSound('kill');
    this.cameras.main.shake(SIDE_KILL_SHAKE_MS, SIDE_KILL_SHAKE_INTENSITY);
    this.spawnDeathBurst(ex, ey);
    this.spawnCoinDrop(ex, ey);

    if (this.enemies.length === 0 && !this.roomCleared) {
      this.roomCleared = true;
      playSound('levelUp');
      this.clearCoinsText.setText(`铜钱总数：${this.coins}`);
      this.clearGroup.setVisible(true);
    }
    this.updateHud();
  }

  private spawnDeathBurst(x: number, y: number): void {
    this.burstsSpawned += 1;
    for (let i = 0; i < 7; i += 1) {
      const angle = (Math.PI * 2 * i) / 7;
      const dist = 18 + (i % 3) * 8;
      const p = this.add
        .rectangle(x, y, i % 3 === 0 ? 5 : 4, i % 3 === 0 ? 5 : 4, i % 2 === 0 ? 0xfbf6e9 : 0xe8b34b)
        .setDepth(13);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        angle: i % 2 === 0 ? 140 : -140,
        alpha: 0,
        duration: 240,
        onComplete: () => p.destroy(),
      });
    }
  }

  private spawnCoinDrop(x: number, y: number): void {
    // Render-only scatter: the logical position stays at the drop point
    // (enemy feet) and only the visual arc moves, decaying back to zero.
    const scatter = computeSideCoinScatterVelocity();
    const coin = this.add.image(x, y + 10, 'coin_dart').setDisplaySize(24, 24).setDepth(7);
    this.coinDrops.push({
      sprite: coin,
      logicalX: x,
      logicalY: y + 10,
      scatterVx: scatter.vx,
      scatterVy: scatter.vy,
      scatterHopPeak: scatter.hopPeak,
      scatterTimer: scatter.duration,
      scatterMax: scatter.duration,
    });
  }

  /** Floating number for the player (simple path; enemy hits merge instead). */
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

  /**
   * Enemy damage number with merging: hits on the same enemy inside the
   * merge window add into the existing number instead of stacking labels.
   * At most SIDE_MAX_DAMAGE_NUMBERS are on screen; the oldest is dropped.
   */
  private spawnDamageNumber(enemy: EnemyUnit, damage: number): void {
    this.damageNumbersShown += 1;
    const body = enemy.sprite.body as Phaser.Physics.Arcade.Body;
    const x = body.center.x;
    const y = body.center.y - 24;

    for (const entry of this.damageNumbers) {
      if (canMergeSideDamageNumber(entry, enemy.id)) {
        entry.amount += damage;
        entry.sinceLastHit = 0;
        entry.label.setText(`-${formatSideDamageNumber(entry.amount)}`);
        // A late merge must not show the new total at the old fade's low
        // alpha: restore full opacity, then fade over the remaining life.
        entry.label.setAlpha(1);
        // Refresh the rise from the current spot; the merged number lives
        // at most SIDE_DAMAGE_NUMBER_MAX_MERGED_LIFE from creation.
        this.tweens.killTweensOf(entry.label);
        const remainingMs = Math.max(
          150,
          (SIDE_DAMAGE_NUMBER_MAX_MERGED_LIFE - entry.totalLife) * 1000,
        );
        this.tweens.add({
          targets: entry.label,
          y: entry.label.y - SIDE_DAMAGE_NUMBER_RISE_PX,
          alpha: 0,
          duration: remainingMs,
          onComplete: () => this.removeDamageNumber(entry),
        });
        return;
      }
    }

    if (this.damageNumbers.length >= SIDE_MAX_DAMAGE_NUMBERS) {
      const oldest = this.damageNumbers[0];
      if (oldest) {
        this.removeDamageNumber(oldest);
      }
    }

    const label = addPixelText(this, x, y, `-${formatSideDamageNumber(damage)}`, {
      size: 12,
      color: PALETTE.lanternYellow,
      origin: 0.5,
    }).setDepth(18);
    const entry: DamageNumberEntry = {
      enemyId: enemy.id,
      label,
      amount: damage,
      sinceLastHit: 0,
      totalLife: 0,
    };
    this.damageNumbers.push(entry);
    this.tweens.add({
      targets: label,
      y: y - SIDE_DAMAGE_NUMBER_RISE_PX,
      alpha: 0,
      duration: SIDE_DAMAGE_NUMBER_DURATION_MS,
      onComplete: () => this.removeDamageNumber(entry),
    });
  }

  private removeDamageNumber(entry: DamageNumberEntry): void {
    const idx = this.damageNumbers.indexOf(entry);
    if (idx === -1) {
      return;
    }
    this.damageNumbers.splice(idx, 1);
    this.tweens.killTweensOf(entry.label);
    if (entry.label.active) {
      entry.label.destroy();
    }
  }

  /**
   * Shifts the render-only knockback offsets onto enemy sprites. Runs on
   * PRE_RENDER, after World.postUpdate has synced every sprite back to its
   * body and after the final dash POST_UPDATE check (so the sprite is
   * exactly at its logical position here, and no gameplay read sees the
   * shift).
   *
   * The shift must NOT survive into the next frame's PRE_UPDATE: Body
   * preUpdate re-derives the body position from the sprite every frame
   * (updateFromGameObject), so a shifted sprite would drag its physics body
   * along. Restore runs on RENDER — after the scene is drawn, before the
   * next preUpdate — and subtracts exactly the offset recorded here
   * (appliedKnockX/Y), because the dash check can change the live knockX/Y
   * after this shift was applied.
   */
  private applyRenderOffsets(): void {
    for (const enemy of this.enemies) {
      if (enemy.knockX !== 0 || enemy.knockY !== 0) {
        enemy.sprite.x += enemy.knockX;
        enemy.sprite.y += enemy.knockY;
      }
      enemy.appliedKnockX = enemy.knockX;
      enemy.appliedKnockY = enemy.knockY;
    }
  }

  /** Restores enemy sprites to their logical (body) positions. Runs on RENDER. */
  private restoreRenderOffsets(): void {
    for (const enemy of this.enemies) {
      if (enemy.appliedKnockX !== 0 || enemy.appliedKnockY !== 0) {
        enemy.sprite.x -= enemy.appliedKnockX;
        enemy.sprite.y -= enemy.appliedKnockY;
      }
      enemy.appliedKnockX = 0;
      enemy.appliedKnockY = 0;
    }
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
      this.cancelSquash();
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
      this.cancelSquash();
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
        this.spawnDust(this.player.x, this.player.y + 20, 3);
        this.startSquash('crouch');
      }
    }

    this.player.setFlipX(this.facing < 0);

    // Landing: dust at the feet, plus a squash when landing clean
    // (not mid-roll / mid-dash, where angle and alpha already carry it).
    const groundedNow = body.blocked.down;
    if (this.wasAirborne && groundedNow) {
      this.spawnDust(this.player.x, this.player.y + 20, 4);
      if (this.rollTimer <= 0 && this.dashTimer <= 0) {
        this.startSquash('land');
      }
    }
    this.wasAirborne = !groundedNow;

    // Afterimages: roll leaves faint ghosts, dash leaves stretched ghosts
    // plus speed lines — the two verbs read differently at the same speed.
    if (this.rollTimer > 0) {
      this.afterimageTimer += dt;
      if (this.afterimageTimer >= SIDE_AFTERIMAGE_INTERVAL_SECONDS) {
        this.afterimageTimer = 0;
        this.spawnAfterimage(SIDE_ROLL_AFTERIMAGE_ALPHA, 1);
      }
    } else if (this.dashTimer > 0) {
      this.afterimageTimer += dt;
      if (this.afterimageTimer >= SIDE_AFTERIMAGE_INTERVAL_SECONDS) {
        this.afterimageTimer = 0;
        this.spawnAfterimage(SIDE_DASH_AFTERIMAGE_ALPHA, SIDE_DASH_AFTERIMAGE_STRETCH_X);
      }
      this.speedLineTimer += dt;
      if (this.speedLineTimer >= 0.05) {
        this.speedLineTimer = 0;
        this.spawnSpeedLine();
      }
    } else {
      this.afterimageTimer = 0;
      this.speedLineTimer = 0;
    }

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

    this.updateSquash(dt);
    this.updateDamageNumbers(dt);
    this.updatePlayerTexture(moveInput !== 0 && body.blocked.down, dt);
    this.updateEnemies(dt);
    this.updateCoinDrops(dt);
    this.updateHud();
  }

  private checkDashHits(): void {
    // Dash is an attack, not contact damage: its reach is the visual sweep
    // (S1 behaviour). The player's sprite bounds are the 8-degree dash
    // angle AABB (~68px wide) and the enemy's are its unshifted 64px sprite
    // bounds — a body-bounds check here would cut the reach to 28px and let
    // the dash pass visibly through an enemy without hitting. Contact damage
    // (updateEnemies) keeps body bounds; the render shift is applied on
    // PRE_RENDER, after this check, so getBounds() here is always unshifted.
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
        const eBody = enemy.sprite.body as Phaser.Physics.Arcade.Body;
        this.spawnDashSparks(eBody.center.x, eBody.center.y);
        this.damageEnemy(enemy, i, SIDE_DASH_DAMAGE, this.dashDir, false, 0.15);
      }
    }
    if (hitAny) {
      playSound('hit');
    }
  }

  /** Small gold spark burst where a dash-attack connects (no hitstop: dash stays fast). */
  private spawnDashSparks(x: number, y: number): void {
    for (let i = 0; i < 5; i += 1) {
      const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      const dist = 14 + (i % 2) * 6;
      const p = this.add.rectangle(x, y, 3, 3, 0xf2e3c6).setDepth(13);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        duration: 150,
        onComplete: () => p.destroy(),
      });
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
    const pBounds = this.bodyBounds(this.player);

    for (const enemy of this.enemies) {
      enemy.contactCooldown = Math.max(0, enemy.contactCooldown - dt);

      // Render-only knockback offset decays back to zero.
      const decayed = decaySideKnockbackOffset(enemy.knockX, enemy.knockY, dt);
      enemy.knockX = decayed.x;
      enemy.knockY = decayed.y;

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
        Phaser.Geom.Intersects.RectangleToRectangle(pBounds, this.bodyBounds(enemy.sprite))
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
    // Force: hurt feedback must win over a kill shake that is still running
    // (Phaser drops a shake request while one is running unless force is true).
    this.cameras.main.shake(SIDE_HURT_SHAKE_MS, SIDE_HURT_SHAKE_INTENSITY, true);
    this.spawnFloatingNumber(this.player.x, this.player.y - 28, `-${amount}`, PALETTE.vermilion);
    playSound('hurt');

    if (this.hp <= 0) {
      this.triggerGameOver();
    }
  }

  private updateCoinDrops(dt: number): void {
    for (let i = this.coinDrops.length - 1; i >= 0; i -= 1) {
      const drop = this.coinDrops[i];
      if (drop.scatterTimer > 0) {
        drop.scatterTimer = Math.max(0, drop.scatterTimer - dt);
        const off = computeSideCoinScatterOffset(
          drop.scatterVx,
          drop.scatterVy,
          drop.scatterHopPeak,
          drop.scatterTimer,
          drop.scatterMax,
        );
        drop.sprite.setPosition(drop.logicalX + off.x, drop.logicalY + off.y);
      } else {
        drop.sprite.setPosition(drop.logicalX, drop.logicalY);
      }
      // Pickup is measured against the logical position, never the visual arc.
      const dist = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        drop.logicalX,
        drop.logicalY,
      );
      if (dist <= SIDE_COIN_PICKUP_RADIUS) {
        drop.sprite.destroy();
        this.coinDrops.splice(i, 1);
        this.coins += 1;
      }
    }
  }

  private startSquash(phase: 'crouch' | 'land'): void {
    if (this.rollTimer > 0 || this.dashTimer > 0) {
      return;
    }
    this.squashPhase = phase;
    this.squashTimer =
      phase === 'crouch' ? SIDE_SQUASH_CROUCH_SECONDS : SIDE_SQUASH_LAND_SECONDS;
  }

  private cancelSquash(): void {
    if (!this.squashPhase) {
      return;
    }
    this.squashPhase = null;
    this.setPlayerVisualScale(1, 1);
  }

  private updateSquash(dt: number): void {
    if (!this.squashPhase) {
      return;
    }
    this.squashTimer -= dt;
    if (this.squashPhase === 'crouch' && this.squashTimer <= 0) {
      // Crouch flows into the stretch as the player leaves the ground.
      this.squashPhase = 'stretch';
      this.squashTimer = SIDE_SQUASH_STRETCH_SECONDS;
    } else if (this.squashTimer <= 0) {
      this.squashPhase = null;
      this.setPlayerVisualScale(1, 1);
      return;
    }
    const s =
      this.squashPhase === 'crouch'
        ? SIDE_SQUASH_CROUCH
        : this.squashPhase === 'stretch'
          ? SIDE_SQUASH_STRETCH
          : SIDE_SQUASH_LAND;
    this.setPlayerVisualScale(s.sx, s.sy);
  }

  /**
   * Scales the player sprite visually while keeping the physics body exactly
   * 28x48 in place (see compensatePlayerBodyScale): squash & stretch never
   * changes collision.
   *
   * Body.setSize computes width/height from the scale cached at the last
   * preUpdate, so right after a scale change the body is briefly the wrong
   * size (e.g. 23.33x60 when entering the crouch) until the next physics
   * step. updateBounds() re-derives it immediately from the current sprite
   * scale, so updateEnemies() in this same update() never reads it wrong.
   */
  private setPlayerVisualScale(sx: number, sy: number): void {
    this.player.setScale(sx, sy);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const comp = compensatePlayerBodyScale(sx, sy);
    body.setSize(comp.width, comp.height);
    body.setOffset(comp.offsetX, comp.offsetY);
    body.updateBounds();
  }

  private spawnAfterimage(alpha: number, stretchX: number): void {
    const ghost = this.add
      .image(this.player.x, this.player.y, this.player.texture.key)
      .setFlipX(this.facing < 0)
      .setAlpha(alpha)
      .setDepth(7);
    if (stretchX !== 1) {
      ghost.setScale(stretchX, 1);
    }
    this.tweens.add({
      targets: ghost,
      alpha: 0,
      duration: SIDE_AFTERIMAGE_LIFETIME_MS,
      onComplete: () => ghost.destroy(),
    });
  }

  private spawnSpeedLine(): void {
    const dir = this.dashDir;
    const y = this.player.y + (Math.random() - 0.5) * 36;
    const x = this.player.x - dir * (20 + Math.random() * 30);
    const line = this.add.rectangle(x, y, 26, 2, 0xf2e3c6).setDepth(7).setAlpha(0.7);
    this.tweens.add({
      targets: line,
      x: x - dir * 60,
      alpha: 0,
      duration: 150,
      onComplete: () => line.destroy(),
    });
  }

  private spawnDust(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const dir = i % 2 === 0 ? 1 : -1;
      const puff = this.add
        .rectangle(x + dir * (4 + i * 3), y - 2, 5, 3, 0xd9a066)
        .setDepth(6)
        .setAlpha(0.8);
      this.tweens.add({
        targets: puff,
        x: puff.x + dir * 14,
        y: puff.y - 6,
        alpha: 0,
        duration: 300,
        onComplete: () => puff.destroy(),
      });
    }
  }

  /** Ages merged damage numbers; a merged number caps at MAX_MERGED_LIFE. */
  private updateDamageNumbers(dt: number): void {
    for (let i = this.damageNumbers.length - 1; i >= 0; i -= 1) {
      const entry = this.damageNumbers[i];
      entry.sinceLastHit += dt;
      entry.totalLife += dt;
      if (entry.totalLife >= SIDE_DAMAGE_NUMBER_MAX_MERGED_LIFE) {
        this.removeDamageNumber(entry);
      }
    }
  }
}
