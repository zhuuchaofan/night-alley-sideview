import Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOSS_DEMON_CORE_DROP,
  BOSS_LAMP_OIL_DROP,
  CURSE_DEFS,
  CURSE_ORDER,
  type CurseId,
  ELITE_LAMP_OIL_DROP,
  type EnemyKind,
  HUD_HEIGHT,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  type PlayerForm,
  SHOP_COUNTER_INTERACT_RADIUS,
  SHOP_COUNTER_X,
  SHOP_ITEMS,
  type ShopItemId,
  SHOOTER_BOLT_DAMAGE,
  SHOOTER_BOLT_SPEED,
  SHOOTER_FIRE_COOLDOWN,
  SHOOTER_RANGE,
  SHOOTER_RETREAT_DIST,
  SIDE_CHARGE_THRESHOLD,
  SIDE_COIN_PICKUP_RADIUS,
  SIDE_DASH_COOLDOWN,
  SIDE_DASH_DAMAGE,
  SIDE_DASH_DURATION,
  SIDE_DASH_SPEED,
  SIDE_ENEMY_VISUAL_GAP,
  SIDE_ENEMY_CHASE_STANDOFF,
  SIDE_ENEMY_SEPARATION_MARGIN,
  SIDE_GROUND_Y,
  SIDE_HEAVY_DAMAGE,
  SIDE_HEAVY_HEIGHT,
  SIDE_HEAVY_HITSTOP_MS,
  SIDE_HEAVY_WIDTH,
  SIDE_JUMP_VELOCITY,
  SIDE_ROLL_COOLDOWN,
  SIDE_ROLL_DURATION,
  SIDE_ROLL_SPEED,
  SIDE_SWING_COOLDOWN,
  SIDE_SWING_DAMAGE,
  SIDE_SWING_HEIGHT,
  SIDE_SWING_WIDTH,
  SIDE_SWITCH_ATTACK_DAMAGE,
  SIDE_SWITCH_ATTACK_HEIGHT,
  SIDE_SWITCH_ATTACK_RANGE,
  SIDE_SWITCH_COOLDOWN,
  SIDE_SWITCH_FRAME_SECONDS,
  SIDE_SWITCH_VISUAL_DURATION,
  SIDE_TALISMAN_COOLDOWN,
  SIDE_TALISMAN_DAMAGE,
  SIDE_TALISMAN_FRAME_SECONDS,
  SIDE_TALISMAN_RANGE,
  SIDE_TALISMAN_SPEED,
  SIDE_TALISMAN_VISUAL_DURATION,
  SIDE_WALL_WIDTH,
  sideEnemyStatsForKind,
} from '../game/balance.ts';
import { addPixelText } from '../game/pixelFont.ts';
import { buildNightAlleyBackdrop, computePlatformTileLayout, ensureGameTextures, PALETTE } from '../game/pixelart.ts';
import {
  applySideKnockbackImpulse,
  canMergeSideDamageNumber,
  compensateEnemyBodyScale,
  compensatePlayerBodyScale,
  computeSideCoinScatterOffset,
  computeSideCoinScatterVelocity,
  decaySideKnockbackOffset,
  formatSideDamageNumber,
  rectsStrictlyOverlap,
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
import type { DoorDebugInfo } from '../game/sideDebug.ts';
import {
  chainSignature,
  generateStage,
  getTemplateById,
  resolveTemplate,
  type RoomTemplate,
  type StageChain,
} from '../game/rooms.ts';
import { consumePendingSeed, newRandomSeed, setPendingSeed } from '../game/seedStore.ts';
import { playSound } from '../game/sound.ts';

interface EnemyUnit {
  id: number;
  kind: EnemyKind;
  sprite: Phaser.Physics.Arcade.Sprite;
  maxHp: number;
  hp: number;
  speed: number;
  contactDamage: number;
  attackCooldown: number;
  coinDrops: number;
  baseScale: number;
  /** 精灵可见宽度 (display px, 供视觉分离用; 身体盒仍是 28×46)。 */
  visualWidth: number;
  stunScale: number;
  contactCooldown: number;
  stunTimer: number;
  flashTimer: number;
  attackFlashTimer: number;
  aiTimer: number;
  lungeTimer: number;
  windupTimer: number;
  /** Boss 发弹帧计时 (纯视觉, updateEnemies 里递减; 仅 Boss 置位)。 */
  boltTimer: number;
  lungeDir: 1 | -1;
  phase: 1 | 2;
  frozen: boolean;
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
  /** 敌人自己的碰撞体 (地面 + 平台); 敌人销毁时显式 destroy, 不留残留。 */
  colliders: Phaser.Physics.Arcade.Collider[];
}

interface EnemyBolt {
  sprite: Phaser.Physics.Arcade.Sprite;
  vx: number;
  vy: number;
  damage: number;
  life: number;
}

interface TalismanProjectile {
  sprite: Phaser.GameObjects.Image;
  dir: 1 | -1;
  vx: number;
  rangeLeft: number;
  damage: number;
}

type PickupKind = 'coin' | 'oil' | 'core';

function enemyTextureKey(kind: EnemyKind): string {
  return `enemy_${kind}`;
}

function enemyHitTextureKey(kind: EnemyKind): string {
  return `enemy_${kind}_hit`;
}

interface CoinDrop {
  /** Non-physics image; the logical position never moves during the scatter. */
  sprite: Phaser.GameObjects.Image;
  kind: PickupKind;
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

interface Door {
  choice: number;
  label: string;
  zone: Phaser.GameObjects.Zone;
  bg: Phaser.GameObjects.Rectangle;
  /** 门板像素图 (64×96, 居中盖在门区上; hideDoors 里销毁)。 */
  img: Phaser.GameObjects.Image;
  labelText: Phaser.GameObjects.BitmapText;
  bounds: Phaser.Geom.Rectangle;
  overlap: Phaser.Physics.Arcade.Collider;
  /** 门生成时玩家已在门区内则为 false, 须先离开、再重新进入才启用。 */
  overlapArmed: boolean;
}

export class SideGameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  /** 常驻地面组 (不随换房重建)。 */
  private groundGroup!: Phaser.Physics.Arcade.StaticGroup;
  /** 可变平台组: 每间房按模板重建 (clear 时销毁成员, 含静态体)。 */
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private enemies: EnemyUnit[] = [];
  private enemyBolts: EnemyBolt[] = [];
  private contactSignals: { enemyId: number; timeMs: number }[] = [];
  private coinDrops: CoinDrop[] = [];
  private damageNumbers: DamageNumberEntry[] = [];
  /** 玩家受击飘字 (spawnFloatingNumber 另起的 label + tween, 不走 damageNumbers)。 */
  private floatingNumbers: Phaser.GameObjects.BitmapText[] = [];
  private nextEnemyId = 1;

  private hp = PLAYER_MAX_HP;
  private maxHp = PLAYER_MAX_HP;
  private kills = 0;
  private coins = 0;
  private lampOil = 0;
  private demonCore = 0;
  private form: PlayerForm = 'sword';
  private switchCooldown = 0;
  private switchVisualTimer = 0;
  private talismanCooldown = 0;
  private talismanVisualTimer = 0;
  private talismanProjectiles: TalismanProjectile[] = [];
  private curse: CurseId | null = null;
  private shopPurchased = new Set<ShopItemId>();
  private swordDamageBonus = 0;
  private talismanDamageBonus = 0;
  private activeOverlay: 'curse' | 'shop' | null = null;
  private overlayObjects: Phaser.GameObjects.GameObject[] = [];
  private shopHintText!: Phaser.GameObjects.BitmapText;
  private roomCleared = false;
  private gameOverTriggered = false;

  /** S2 房间链状态 (§4)。 */
  private chain!: StageChain;
  private roomIndex = 0;
  private runSeed = 0;
  private currentTemplate!: RoomTemplate;
  /** 整关打通 (与 roomCleared 分离): 只有它才弹结算横幅并解锁 R/Esc。 */
  private stageCleared = false;
  private doorUsed = false;
  private pendingTransition: { next: number } | null = null;
  private doors: Door[] = [];
  /** 诊断: submitDoor 被调用的总次数 (含被 doorUsed 挡下的重复提交)。 */
  private doorSubmitAttempts = 0;
  /** 双门时站在门区内显示的「按 E 进入」提示（单门走路即进，不用提示）。 */
  private doorHintText!: Phaser.GameObjects.BitmapText;
  /** 诊断: 场景级 pointerdown 事件计数 (门点击失效排查用)。 */
  private debugPointerDownCount = 0;
  /** 房间代次: 换房时 +1, 让上一间房挂起的 POST_UPDATE 一次性回调失效。 */
  private roomGeneration = 0;
  private roomBannerText!: Phaser.GameObjects.BitmapText;
  private roomBannerTimer?: Phaser.Time.TimerEvent;
  private roomDecor: Phaser.GameObjects.GameObject[] = [];

  /** Game-feel counters exposed on the debug hook for E2E assertions. */
  private damageNumbersShown = 0;
  private burstsSpawned = 0;
  private hitstopsApplied = 0;
  private heavyShakesApplied = 0;

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
  private walkFrameIndex = 0;

  private swingCooldown = 0;
  private swingVisualTimer = 0;
  /** 本次挥剑是否重击 + 挥剑视觉总时长 (performSwordStrike 记, updatePlayerTexture 按已流逝时间分三段)。 */
  private swingHeavy = false;
  private swingVisualTotal = 0;
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
  private roomText!: Phaser.GameObjects.BitmapText;
  private coinsText!: Phaser.GameObjects.BitmapText;
  private pickupsHudText!: Phaser.GameObjects.BitmapText;
  private rollHudText!: Phaser.GameObjects.BitmapText;
  private dashHudText!: Phaser.GameObjects.BitmapText;
  private formHudText!: Phaser.GameObjects.BitmapText;
  private curseHudText!: Phaser.GameObjects.BitmapText;
  private bossBarBg!: Phaser.GameObjects.Rectangle;
  private bossBarFill!: Phaser.GameObjects.Rectangle;
  private bossBarLabel!: Phaser.GameObjects.BitmapText;

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
  /** 双门进门确认键 (E)：站在门区内按 E 进该门（见 updateBranchDoorPrompt）。 */
  private keyE!: Phaser.Input.Keyboard.Key;

  constructor() {
    super('SideGameScene');
  }

  create(data?: { seed?: number }): void {
    this.resetState();
    ensureGameTextures(this);
    buildNightAlleyBackdrop(this, 0);

    this.physics.world.setBounds(
      SIDE_WALL_WIDTH,
      HUD_HEIGHT,
      ARENA_WIDTH - SIDE_WALL_WIDTH * 2,
      ARENA_HEIGHT - HUD_HEIGHT,
    );

    this.createArenaBase();
    this.createForeground();
    this.createPlayer();
    this.createHud();
    this.createClearBanner();
    this.createRoomBanner();
    this.bindInputs();

    // 定种子 → 生成整条链 → 进第 1 间房。data.seed 优先 (Title/GameOver/R 重试传入);
    // 无则消费一次待用调试种子, 再无则随机新种子。
    this.runSeed = data?.seed ?? consumePendingSeed() ?? newRandomSeed();
    this.chain = generateStage(this.runSeed);
    this.enterRoom(0);
    this.updateHud();

    registerSideDebugHook({
      getState: () => {
        // Boss 调试字段 (只读新增): bossBarLabel 文本与 Boss phase, 供 E2E 用。
        // 不改 sideDebug.ts 的接口: 用展开拼进返回对象 (展开不触发多余属性检查)。
        const boss = this.enemies.find((e) => e.kind === 'boss');
        const bossDebug = {
          bossBarLabel: boss ? this.bossBarLabel.text : '',
          bossPhase: boss ? boss.phase : 0,
        };
        return {
          scene: 'SideGameScene',
          ...bossDebug,
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
        heavyShakesApplied: this.heavyShakesApplied,
        timeNow: Math.round(this.time.now),
        seed: this.runSeed,
        roomIndex: this.roomIndex,
        roomType: this.currentTemplate.type,
        roomCount: this.chain.slots.length,
        roomTemplateId: this.currentTemplate.id,
        hudRoomText: this.roomText.text,
        stageCleared: this.stageCleared,
        chainSignature: chainSignature(this.chain),
        doors: this.doors.map(
          (d): DoorDebugInfo => ({ choice: d.choice, label: d.label }),
        ),
        doorUsed: this.doorUsed,
        pendingNext: this.pendingTransition ? this.pendingTransition.next : null,
        doorSubmitAttempts: this.doorSubmitAttempts,
        activeColliders: this.physics.world.colliders.getActive().length,
        doorInput: this.doors.map((d) => ({
          choice: d.choice,
          hasInput: Boolean(d.bg.input),
          enabled: d.bg.input ? d.bg.input.enabled : false,
        })),
        inputListSize: (this.input as unknown as { _list: unknown[] })._list.length,
        pendingInsertionSize: (this.input as unknown as { _pendingInsertion: unknown[] })
          ._pendingInsertion.length,
        pointerDowns: this.debugPointerDownCount,
        bodyBottom: Math.round(
          (this.player.body as Phaser.Physics.Arcade.Body).bottom,
        ),
        grounded: (this.player.body as Phaser.Physics.Arcade.Body).blocked.down,
        rolling: this.rollActiveThisFrame,
        playerBody: (() => {
          const pb = this.player.body as Phaser.Physics.Arcade.Body;
          return {
            left: Math.round(pb.left),
            right: Math.round(pb.right),
            top: Math.round(pb.top),
            bottom: Math.round(pb.bottom),
          };
        })(),
        enemyBodyBottoms: this.enemies.map((e) =>
          Math.round((e.sprite.body as Phaser.Physics.Arcade.Body).bottom),
        ),
        enemyInfos: this.enemies.map((e) => {
          const eb = e.sprite.body as Phaser.Physics.Arcade.Body;
          return {
            id: e.id,
            kind: e.kind,
            x: Math.round(e.sprite.x),
            y: Math.round(e.sprite.y),
            bodyLeft: Math.round(eb.left),
            bodyRight: Math.round(eb.right),
            bodyTop: Math.round(eb.top),
            bodyBottom: Math.round(eb.bottom),
            bodyLeftRaw: eb.left,
            bodyRightRaw: eb.right,
            bodyTopRaw: eb.top,
            bodyBottomRaw: eb.bottom,
            hp: e.hp,
            hitFlash: e.flashTimer > 0,
            attackFlash: e.attackFlashTimer > 0,
            windup: e.windupTimer > 0,
            knockX: Math.round(e.knockX),
          };
        }),
        contactSignals: this.contactSignals.slice(),
        enemyBoltsAlive: this.enemyBolts.length,
        coinDropsAlive: this.coinDrops.filter((d) => d.kind === 'coin').length,
        form: this.form,
        maxHp: this.maxHp,
        velocityX: Math.round((this.player.body as Phaser.Physics.Arcade.Body).velocity.x),
        switchCooldown: Number(this.switchCooldown.toFixed(3)),
        talismanCooldown: Number(this.talismanCooldown.toFixed(3)),
        talismanProjectilesAlive: this.talismanProjectiles.length,
        curse: this.curse,
        curseMenuOpen: this.activeOverlay === 'curse',
        shopMenuOpen: this.activeOverlay === 'shop',
        shopPurchased: [...this.shopPurchased],
        lampOil: this.lampOil,
        demonCore: this.demonCore,
        oilDropsAlive: this.coinDrops.filter((d) => d.kind === 'oil').length,
        coreDropsAlive: this.coinDrops.filter((d) => d.kind === 'core').length,
        paused: this.physics.world.isPaused,
        swordDamage: this.getSwordDamage(false),
        talismanDamage: this.getTalismanDamage(),
        hudFormText: this.formHudText.text,
        hudCurseText: this.curseHudText.visible ? this.curseHudText.text : '',
        hudPickupsText: this.pickupsHudText.text,
        };
      },
      spawnEnemyNearPlayer: (kind: EnemyKind = 'paper') => {
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
        // 脚底锚点: 用玩家身体盒底 (body.bottom = sprite.y + 22) 作 surfaceY。
        const footY = (this.player.body as Phaser.Physics.Arcade.Body).bottom;
        this.spawnEnemyFromFoot(spawnX, footY, kind);
        if (this.roomCleared) {
          // 调试重生敌人 = 房间不再清空: 收门、撤结算横幅 (S1 语义)。
          this.roomCleared = false;
          if (this.stageCleared) {
            this.stageCleared = false;
            this.clearGroup.setVisible(false);
          }
          this.hideDoors();
        }
        this.updateHud();
      },
      clearEnemies: () => {
        for (const enemy of this.enemies) {
          this.destroyEnemyUnit(enemy);
        }
        this.enemies = [];
        for (const bolt of this.enemyBolts) {
          bolt.sprite.destroy();
        }
        this.enemyBolts = [];
        this.updateHud();
      },
      placeTestEnemy: (kind: EnemyKind, footX: number, surfaceY: number, frozen = false) => {
        if (this.gameOverTriggered) {
          return;
        }
        this.spawnEnemyFromFoot(footX, surfaceY, kind, frozen);
        if (this.roomCleared) {
          this.roomCleared = false;
          if (this.stageCleared) {
            this.stageCleared = false;
            this.clearGroup.setVisible(false);
          }
          this.hideDoors();
        }
        this.updateHud();
      },
      setHp: (nextHp: number) => {
        if (this.gameOverTriggered) {
          return;
        }
        this.hp = Math.max(0, Math.min(this.maxHp, nextHp));
        this.updateHud();
        if (this.hp <= 0) {
          this.triggerGameOver();
        }
      },
      setCoins: (nextCoins: number) => {
        if (this.gameOverTriggered) {
          return;
        }
        this.coins = Math.max(0, nextCoins);
        this.updateHud();
      },
      // 只写待用种子, 不改当前局; 下次开局 (经标题) 时消费一次。
      setSeed: (seed: number) => {
        setPendingSeed(seed);
      },
      // 测试专用: 直接进指定模板的房间 (Arcade 走跳验收用), 不走选门流程。
      enterTemplate: (templateId: string) => {
        const template = getTemplateById(templateId);
        if (!template || this.gameOverTriggered) {
          return;
        }
        this.clearRoomState();
        this.enterRoomWithTemplate(template);
        this.updateHud();
      },
      // 测试专用: 把玩家传送到指定位置 (走跳验收用)。
      teleportPlayer: (x: number, y: number) => {
        if (this.gameOverTriggered) {
          return;
        }
        this.player.setAngle(0);
        this.player.setAlpha(1);
        const body = this.player.body as Phaser.Physics.Arcade.Body;
        body.reset(x, y);
        this.wasAirborne = false;
      },
      // 测试专用: 对当前活动指针做一次 hitTest (诊断点门失效)。
      probeHit: () => {
        const pointer = this.input.activePointer;
        const over = this.input.hitTestPointer(pointer);
        return {
          px: Math.round(pointer.x),
          py: Math.round(pointer.y),
          over: over.map((o) => {
            const pos = o as unknown as { x: number; y: number };
            return `${o.type}@${Math.round(pos.x)},${Math.round(pos.y)}`;
          }),
          listSize: (this.input as unknown as { _list: unknown[] })._list.length,
        };
      },
    });
  }

  private resetState(): void {
    this.enemies = [];
    this.enemyBolts = [];
    this.contactSignals = [];
    this.coinDrops = [];
    this.damageNumbers = [];
    this.nextEnemyId = 1;
    this.hp = PLAYER_MAX_HP;
    this.maxHp = PLAYER_MAX_HP;
    this.kills = 0;
    this.coins = 0;
    this.lampOil = 0;
    this.demonCore = 0;
    this.form = 'sword';
    this.switchCooldown = 0;
    this.switchVisualTimer = 0;
    this.talismanCooldown = 0;
    this.talismanVisualTimer = 0;
    this.talismanProjectiles = [];
    this.curse = null;
    this.shopPurchased.clear();
    this.swordDamageBonus = 0;
    this.talismanDamageBonus = 0;
    this.activeOverlay = null;
    this.overlayObjects = [];
    this.roomCleared = false;
    this.gameOverTriggered = false;
    this.roomIndex = 0;
    this.runSeed = 0;
    this.stageCleared = false;
    this.doorUsed = false;
    this.pendingTransition = null;
    this.doors = [];
    this.roomGeneration = 0;
    this.roomBannerTimer = undefined;
    this.roomDecor = [];
    this.damageNumbersShown = 0;
    this.burstsSpawned = 0;
    this.hitstopsApplied = 0;
    this.heavyShakesApplied = 0;
    this.hitstopEvent = undefined;
    this.afterimageTimer = 0;
    this.speedLineTimer = 0;
    this.wasAirborne = false;
    this.squashPhase = null;
    this.squashTimer = 0;
    this.facing = 1;
    this.walkTimer = 0;
    this.walkFrameIndex = 0;
    this.swingCooldown = 0;
    this.swingVisualTimer = 0;
    this.swingHeavy = false;
    this.swingVisualTotal = 0;
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

  /** 竞技场底座: 常驻地面 + 空的可变平台组 (每间房按模板重建)。 */
  private createArenaBase(): void {
    this.groundGroup = this.physics.add.staticGroup();

    // Ground: top at y = 500, tile_ground 平铺 960×40。
    const ground = this.add
      .tileSprite(0, SIDE_GROUND_Y, ARENA_WIDTH, 40, 'tile_ground')
      .setOrigin(0, 0)
      .setDepth(4);
    this.add.rectangle(ARENA_WIDTH / 2, SIDE_GROUND_Y + 2, ARENA_WIDTH, 4, 0x8a5a33).setDepth(5);
    this.groundGroup.add(ground);

    this.platforms = this.physics.add.staticGroup();
  }

  /** 前景遮挡 (depth 11): 顶檐一条 + 悬索两条 (y=150 横贯、y=300 两侧各一截),
   * 一次性加, 不进门区与蓄力条区。 */
  private createForeground(): void {
    this.add
      .tileSprite(0, 60, ARENA_WIDTH, 32, 'decor_eaves')
      .setOrigin(0, 0)
      .setDepth(11);
    this.add
      .tileSprite(0, 150, ARENA_WIDTH, 16, 'decor_rope')
      .setOrigin(0, 0)
      .setDepth(11);
    // y=300 悬索只在两侧露一截 (x 0–64 / 896–960): 平台到不了墙带、地面怪顶约 y 400,
    // 两侧段遮不到任何敌人。
    this.add
      .tileSprite(0, 300, 64, 16, 'decor_rope')
      .setOrigin(0, 0)
      .setDepth(11);
    this.add
      .tileSprite(ARENA_WIDTH - 64, 300, 64, 16, 'decor_rope')
      .setOrigin(0, 0)
      .setDepth(11);
  }

  private addPlatform(x: number, y: number, w: number, h: number): void {
    // 物理体: 与原平台同 x/y/w/h 的不可见静态体 (单向平台标志照旧)。
    const bodyRect = this.add.rectangle(x, y, w, h, 0x000000, 0).setVisible(false);
    this.platforms.add(bodyRect);
    const body = bodyRect.body as Phaser.Physics.Arcade.StaticBody;
    body.checkCollision.down = false;
    body.checkCollision.left = false;
    body.checkCollision.right = false;
    // 视觉: 左端 + 中段 + 右端三段式 (depth 4), 位置与尺寸不动。
    const leftX = x - w / 2;
    const topY = y - h / 2;
    for (const seg of computePlatformTileLayout(w)) {
      if (seg.key === 'tile_platform_mid') {
        this.add
          .tileSprite(leftX + seg.offsetX, topY, seg.width, h, seg.key)
          .setOrigin(0, 0)
          .setDepth(4);
      } else {
        this.add
          .image(leftX + seg.offsetX, topY, seg.key)
          .setOrigin(0, 0)
          .setDepth(4);
      }
    }
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(180, SIDE_GROUND_Y - 32, 'player_idle').setDepth(8);
    this.player.setCollideWorldBounds(true);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body
      .setSize(SIDE_PLAYER_BODY_WIDTH, SIDE_PLAYER_BODY_HEIGHT)
      .setOffset(SIDE_PLAYER_BODY_OFFSET_X, SIDE_PLAYER_BODY_OFFSET_Y);

    this.physics.add.collider(this.player, this.groundGroup);
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

    this.hpText = addPixelText(this, 16, 22, '', { size: 24, color: PALETTE.paperWhite, origin: [0, 0.5] }).setDepth(21);
    this.enemiesText = addPixelText(this, 160, 22, '', { size: 24, color: PALETTE.vermilion, origin: [0, 0.5] }).setDepth(21);
    this.roomText = addPixelText(this, 248, 22, '', { size: 24, color: PALETTE.candleLight, origin: [0, 0.5] }).setDepth(21);
    this.coinsText = addPixelText(this, 360, 22, '', { size: 24, color: PALETTE.lanternYellow, origin: [0, 0.5] }).setDepth(21);
    this.pickupsHudText = addPixelText(this, 456, 22, '', { size: 12, color: PALETTE.oldPaper, origin: [0, 0.5] }).setDepth(21);
    this.rollHudText = addPixelText(this, 550, 22, '', { size: 24, color: PALETTE.silverBlue, origin: [0, 0.5] }).setDepth(21);
    this.dashHudText = addPixelText(this, 675, 22, '', { size: 24, color: PALETTE.oldPaper, origin: [0, 0.5] }).setDepth(21);
    this.formHudText = addPixelText(this, 800, 14, '', { size: 12, color: PALETTE.paperWhite, origin: [0, 0.5] }).setDepth(21);
    this.curseHudText = addPixelText(this, 800, 30, '', { size: 12, color: PALETTE.vermilion, origin: [0, 0.5] })
      .setDepth(21)
      .setVisible(false);

    this.bossBarBg = this.add
      .rectangle(ARENA_WIDTH / 2, HUD_HEIGHT + 22, 320, 12, 0x17120c, 0.9)
      .setStrokeStyle(2, 0xc9973f)
      .setDepth(21)
      .setVisible(false);
    this.bossBarFill = this.add
      .rectangle(ARENA_WIDTH / 2 - 156, HUD_HEIGHT + 22, 312, 8, 0xb03a2e)
      .setOrigin(0, 0.5)
      .setDepth(22)
      .setVisible(false);
    this.bossBarLabel = addPixelText(this, ARENA_WIDTH / 2, HUD_HEIGHT + 38, '大心魔', {
      size: 12,
      color: PALETTE.paperWhite,
      origin: 0.5,
    })
      .setDepth(22)
      .setVisible(false);
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
    const hint = addPixelText(this, ARENA_WIDTH / 2, 272, 'R 重试本局 · Esc 返回标题', {
      size: 24,
      color: PALETTE.silverBlue,
      origin: 0.5,
    }).setDepth(26);

    this.clearGroup = this.add.group([panel, title, this.clearCoinsText, hint]);
    this.clearGroup.setVisible(false);
  }

  /** 房间横幅 (enterRoom 时显示约 1.2s): 「夜巷 2/5 · 战斗 · 铜钱」。 */
  private createRoomBanner(): void {
    this.roomBannerText = addPixelText(this, ARENA_WIDTH / 2, 120, '', {
      size: 24,
      color: PALETTE.paperWhite,
      origin: 0.5,
    })
      .setDepth(26)
      .setVisible(false);
    // 双门确认提示：平时隐藏，updateBranchDoorPrompt 在玩家站进某扇门区时
    // 移到该门上方显示。字全部在字库内（按/E/进/入）。
    this.doorHintText = addPixelText(this, ARENA_WIDTH / 2, 372, '按 E 进入', {
      size: 12,
      color: PALETTE.lanternYellow,
      origin: 0.5,
    })
      .setDepth(11)
      .setVisible(false);
    this.shopHintText = addPixelText(this, SHOP_COUNTER_X, 392, '按 F 开店', {
      size: 12,
      color: PALETTE.lanternYellow,
      origin: 0.5,
    })
      .setDepth(11)
      .setVisible(false);
  }

  private bindInputs(): void {
    const kb = this.input.keyboard;
    // 诊断: 场景级 pointerdown 计数 (门点击失效排查用)。
    this.input.on('pointerdown', () => {
      this.debugPointerDownCount++;
    });
    // 门点击统一入口: 按实时门区判定, 不依赖 bg 的 setInteractive 注册时序
    // (见 showDoors)。submitDoor 自带 doorUsed 锁定, 重复点击无效果。
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      for (const door of this.doors) {
        if (door.bounds.contains(pointer.x, pointer.y)) {
          this.submitDoor(door.choice);
          return;
        }
      }
    });
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
    this.keyE = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    const onKeyDownJ = (event: KeyboardEvent): void => {
      if (
        this.activeOverlay !== null ||
        this.physics.world.isPaused ||
        this.gameOverTriggered ||
        this.rollTimer > 0 ||
        this.dashTimer > 0
      ) {
        return;
      }
      if (this.form === 'talisman') {
        if (this.talismanCooldown <= 0) {
          this.performTalismanAttack();
        }
        return;
      }
      if (this.jHeld) {
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
      if (this.form === 'talisman') {
        this.jHeld = false;
        return;
      }
      if (!this.jHeld || this.gameOverTriggered) {
        this.jHeld = false;
        return;
      }
      this.releaseSwordAttack(event.timeStamp - this.jHoldStartMs);
    };

    const onKeyDownQ = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return;
      }
      if (this.activeOverlay !== null || this.physics.world.isPaused || this.gameOverTriggered || this.stageCleared) {
        return;
      }
      this.trySwitchForm();
    };

    const onKeyDownF = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return;
      }
      if (this.gameOverTriggered || this.stageCleared) {
        return;
      }
      if (this.activeOverlay === 'shop') {
        this.closeOverlay();
        return;
      }
      if (this.activeOverlay === null && !this.physics.world.isPaused && this.isNearShopCounter()) {
        this.openShopMenu();
      }
    };

    const onDigitChoice = (idx: 0 | 1 | 2): void => {
      if (this.activeOverlay === 'curse') {
        this.selectCurse(CURSE_ORDER[idx]);
      } else if (this.activeOverlay === 'shop') {
        this.buyShopItem(SHOP_ITEMS[idx].id);
      }
    };
    const onKey1 = (): void => onDigitChoice(0);
    const onKey2 = (): void => onDigitChoice(1);
    const onKey3 = (): void => onDigitChoice(2);

    const onRestart = (): void => {
      // 只有整关打通 (stageCleared) 才解锁 R: 同种子重试本局。
      if (this.stageCleared) {
        this.scene.restart({ seed: this.runSeed });
      }
    };

    const onEscape = (): void => {
      if (this.activeOverlay === 'shop') {
        this.closeOverlay();
        return;
      }
      if (this.stageCleared) {
        this.scene.start('TitleScene');
      }
    };

    kb.on('keydown-J', onKeyDownJ);
    kb.on('keyup-J', onKeyUpJ);
    kb.on('keydown-Q', onKeyDownQ);
    kb.on('keydown-F', onKeyDownF);
    kb.on('keydown-ONE', onKey1);
    kb.on('keydown-TWO', onKey2);
    kb.on('keydown-THREE', onKey3);
    kb.on('keydown-R', onRestart);
    kb.on('keydown-ESC', onEscape);

    const cleanup = (): void => {
      this.events.off(Phaser.Scenes.Events.DESTROY, cleanup);
      this.events.off(Phaser.Scenes.Events.PRE_RENDER, this.applyRenderOffsets, this);
      this.events.off(Phaser.Scenes.Events.RENDER, this.restoreRenderOffsets, this);
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, this.processPendingTransition, this);
      kb.off('keydown-J', onKeyDownJ);
      kb.off('keyup-J', onKeyUpJ);
      kb.off('keydown-Q', onKeyDownQ);
      kb.off('keydown-F', onKeyDownF);
      kb.off('keydown-ONE', onKey1);
      kb.off('keydown-TWO', onKey2);
      kb.off('keydown-THREE', onKey3);
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

    // 换房唯一执行点: 物理回调只提交 pendingTransition, 销毁/重建全部推迟到这里
    // (POST_UPDATE 在物理步之后、渲染之前, 与 PRE_RENDER/RENDER 钩子不冲突:
    //  换房时敌人已从数组移除, PRE_RENDER 不会再碰它们的击退偏移)。
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.processPendingTransition, this);
  }

  /**
   * 按脚底锚点生成敌人: sprite.x = footX, sprite.y = surfaceY - 22
   * (经 setEnemyVisualScale 补偿后, 无论缩放多少, 物理盒恒为 28x46、盒底 = sprite.y + 22 = surfaceY)。
   */
  private spawnEnemyFromFoot(
    footX: number,
    surfaceY: number,
    kind: EnemyKind = 'paper',
    frozen = false,
  ): void {
    const cfg = sideEnemyStatsForKind(kind);
    const sprite = this.physics.add
      .sprite(footX, surfaceY - 22, enemyTextureKey(kind))
      .setDepth(7);
    sprite.setCollideWorldBounds(true);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    this.setEnemyVisualScale(sprite, cfg.visualScale);
    if (frozen) {
      body.setImmovable(true);
      // 冻结怪是定点测试靶: 不参与重力, 否则 immovable 身体无法被地面碰撞
      // 推回、会穿地掉到世界下边界。
      body.setAllowGravity(false);
    }
    // setOffset 只改偏移量、不立即同步身体位置: 这里显式同步, 让 body.bottom
    // 在生成当刻就对齐 surfaceY, 不依赖下一物理步的纠正。
    body.updateFromGameObject();
    const colliders = [
      this.physics.add.collider(sprite, this.groundGroup),
      this.physics.add.collider(sprite, this.platforms),
    ];

    this.enemies.push({
      id: this.nextEnemyId++,
      kind,
      sprite,
      maxHp: cfg.maxHp,
      hp: cfg.maxHp,
      speed: cfg.speed,
      contactDamage: cfg.contactDamage,
      attackCooldown: cfg.attackCooldown,
      coinDrops: cfg.coinDrops,
      baseScale: cfg.visualScale,
      visualWidth: cfg.visualWidth,
      stunScale: cfg.stunScale,
      contactCooldown: 0,
      stunTimer: 0,
      flashTimer: 0,
      attackFlashTimer: 0,
      aiTimer: kind === 'shooter' ? SHOOTER_FIRE_COOLDOWN * 0.6 : kind === 'boss' ? 2.0 : 1.2,
      lungeTimer: 0,
      windupTimer: 0,
      boltTimer: 0,
      lungeDir: -1,
      phase: 1,
      frozen,
      knockX: 0,
      knockY: 0,
      appliedKnockX: 0,
      appliedKnockY: 0,
      colliders,
    });
  }

  /** 销毁一只敌人: 先显式销毁它的 collider, 再销毁 sprite, 不留残留碰撞体。 */
  private destroyEnemyUnit(enemy: EnemyUnit): void {
    for (const collider of enemy.colliders) {
      collider.destroy();
    }
    enemy.colliders = [];
    enemy.sprite.destroy();
  }

  // ---------------------------------------------------------------------------
  // S2 房间链 (§4 场景接入)
  // ---------------------------------------------------------------------------

  /** 进第 i 间房: 清理旧房 → 按槽位模板重建。 */
  private enterRoom(index: number): void {
    this.clearRoomState();
    this.roomIndex = index;
    this.enterRoomWithTemplate(resolveTemplate(this.chain.slots[index]));
  }

  /** 按模板重建一间房 (几何、敌人、横幅); 调用方先做 clearRoomState。 */
  private enterRoomWithTemplate(template: RoomTemplate): void {
    this.currentTemplate = template;
    this.roomCleared = false;
    this.doorUsed = false;
    this.pendingTransition = null;
    // 结算状态也在这里清: 调试直进模板 (enterTemplate) 同样走这里,
    // 精英房打通后直进有敌人的模板, 若不清 stageCleared/结算横幅,
    // R/Esc 仍解锁且横幅还挂着, 与 roomCleared/stageCleared 分离冲突。
    // 正常换房流程里进房时 stageCleared 恒为 false, 这里是 no-op。
    this.stageCleared = false;
    this.clearGroup.setVisible(false);
    this.roomGeneration += 1;

    for (const p of template.platforms) {
      this.addPlatform(p.x, p.y, p.w, p.h);
    }

    if (template.type === 'shop') {
      this.buildShopCounter();
    }

    if (template.type === 'chest') {
      // 宝箱本体 (64×48, 中心 (480,476) 落地): 铜钱锚点不动, 铜钱 depth 7 仍在箱前。
      const chest = this.add.image(480, 476, 'tile_chest').setDepth(4);
      this.roomDecor.push(chest);
    }

    this.buildRoomDecor(template.type);

    this.resetPlayerForRoom();
    for (const s of template.spawns) {
      this.spawnEnemyFromFoot(s.footX, s.surfaceY, s.kind);
    }

    // 模板带的铜钱 (宝箱房) 按现有掉落生命周期生成: 走近即拾取, 换房时未拾取的销毁。
    if (template.coins) {
      for (const c of template.coins) {
        for (let i = 0; i < c.n; i += 1) {
          this.spawnCoinDrop(c.x + (i - (c.n - 1) / 2) * 12, c.y);
        }
      }
    }

    this.showRoomBanner(
      `夜巷 ${this.roomIndex + 1}/${this.chain.slots.length} · ${template.label}`,
    );

    // 初始化后统一检查: 零敌人房 (商店、空宝箱) 进房即清房。
    if (this.enemies.length === 0) {
      this.markRoomCleared();
    }
    this.updateHud();
  }

  /**
   * 清理上一间房的全部房间资源 (§4 资源所有权):
   * 可变平台成员、敌人 (含每只的 collider)、掉落、伤害数字、门 (overlap + 点击监听)、
   * 房间横幅计时器、商店柜台。
   * 地面、静态组本身、玩家与平台组的 collider 常驻不重建。
   * 同时取消跨房瞬时状态 (§4 取消表); 保留 HP/铜钱/击杀数/runSeed/调试计数器。
   */
  private clearRoomState(): void {
    for (const enemy of this.enemies) {
      this.destroyEnemyUnit(enemy);
    }
    this.enemies = [];

    this.clearEnemyBolts();
    this.contactSignals = [];

    for (const drop of this.coinDrops) {
      drop.sprite.destroy();
    }
    this.coinDrops = [];

    for (const proj of this.talismanProjectiles) {
      proj.sprite.destroy();
    }
    this.talismanProjectiles = [];
    this.closeOverlay();
    this.shopHintText.setVisible(false);

    for (const entry of [...this.damageNumbers]) {
      this.removeDamageNumber(entry);
    }

    // 玩家受击飘字不走 damageNumbers: 换房时同样销毁, 不留在旧坐标上。
    for (const label of [...this.floatingNumbers]) {
      this.tweens.killTweensOf(label);
      if (label.active) {
        label.destroy();
      }
    }
    this.floatingNumbers = [];

    this.hideDoors();

    // 可变平台成员全部销毁 (静态体随 GameObject 销毁进 pendingDestroy, 下一步清理)。
    this.platforms.clear(false, true);

    for (const decor of this.roomDecor) {
      // Boss 房青烟带循环 tween: 先停 tween 再销毁, 不留挂起的补间指向死对象。
      this.tweens.killTweensOf(decor);
      decor.destroy();
    }
    this.roomDecor = [];

    if (this.roomBannerTimer) {
      this.roomBannerTimer.remove(false);
      this.roomBannerTimer = undefined;
    }
    this.roomBannerText.setVisible(false);

    // 取消跨房瞬时状态。
    if (this.hitstopEvent) {
      this.hitstopEvent.remove(false);
      this.hitstopEvent = undefined;
      this.physics.world.resume();
    }
    this.jHeld = false;
    this.jHoldStartMs = 0;
    this.hideChargeBar();
    this.swingVisualTimer = 0;
    this.switchVisualTimer = 0;
    this.talismanVisualTimer = 0;
    this.rollTimer = 0;
    this.rollCooldown = 0;
    this.rollActiveThisFrame = false;
    this.rollJustEnded = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashCleanupPending = false;
    this.dashHitIds.clear();
    this.squashPhase = null;
    this.squashTimer = 0;
    this.setPlayerVisualScale(1, 1);
    this.playerFlashTimer = 0;
    this.tweens.killTweensOf(this.screenFlash);
    this.screenFlash.setAlpha(0);
    this.wasAirborne = false;
    this.afterimageTimer = 0;
    this.speedLineTimer = 0;
  }

  /** 玩家回到入口点 (x=100, 地面): 身体盒底正好落在地面顶面。 */
  private resetPlayerForRoom(): void {
    this.player.setAngle(0);
    this.player.setAlpha(1);
    this.player.setFlipX(false);
    this.player.setTexture('player_idle');
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    // 换房可能发生在冲刺中: 冲刺起手关了重力, 冲刺结束的清理
    // (dashCleanupPending) 在 clearRoomState 里被取消, 而 body.reset() 不恢复
    // allowGravity; 这里显式恢复, 否则新房里玩家跳起后不再下落。
    body.setAllowGravity(true);
    body.reset(100, SIDE_GROUND_Y - 22);
    this.facing = 1;
    this.walkTimer = 0;
    this.walkFrameIndex = 0;
  }

  private showRoomBanner(text: string): void {
    if (this.roomBannerTimer) {
      this.roomBannerTimer.remove(false);
    }
    this.roomBannerText.setText(text).setVisible(true);
    this.roomBannerTimer = this.time.delayedCall(1200, () => {
      this.roomBannerTimer = undefined;
      this.roomBannerText.setVisible(false);
    });
  }

  /** 房间装饰 (无碰撞, depth 2–4, 进 roomDecor 由 clearRoomState 销毁)。
   * 禁区: 平台顶面、生成点脚底、门区 x 710–860、玩家出生点 x≈100 一带。
   * 药柜抽屉墙无现成纹理: 用小矩形格阵在右侧墙面带画一个; 悬挂药草束无纹理, 跳过。 */
  private buildRoomDecor(type: RoomTemplate['type']): void {
    const decor = (key: string, x: number, y: number, depth: number): void => {
      this.roomDecor.push(this.add.image(x, y, key).setDepth(depth));
    };
    if (type === 'entrance') {
      decor('decor_pier', 40, 484, 4);
      decor('decor_shadow_wall', 928, 476, 3);
      decor('sign_alley', 480, 100, 3);
    } else if (type === 'combat') {
      decor('decor_crate', 40, 488, 4);
      decor('decor_basket', 920, 492, 4);
      decor('decor_clothesline', 480, 130, 3);
      decor('decor_notice', 40, 260, 3);
      decor('decor_clutter', 200, 496, 4);
    } else if (type === 'chest') {
      decor('decor_candle', 560, 484, 4);
    } else if (type === 'shop') {
      decor('sign_medicine', 200, 396, 3);
      decor('decor_candle', 300, 484, 4);
      // 药柜抽屉墙: 右侧墙面带 (x 896–960) 的小抽屉格阵, 背景装饰非精灵。
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          const cell = this.add
            .rectangle(904 + col * 18, 240 + row * 16, 16, 12, 0x5a3a22)
            .setStrokeStyle(1, 0xc9973f)
            .setDepth(2);
          this.roomDecor.push(cell);
        }
      }
    } else if (type === 'elite') {
      decor('decor_altar', 40, 488, 4);
      decor('decor_candle', 150, 484, 4);
      decor('decor_candle', 880, 484, 4);
      decor('decor_talisman', 400, 210, 3);
      decor('decor_talisman', 480, 200, 3);
      decor('decor_talisman', 560, 210, 3);
      decor('decor_mask', 920, 250, 3);
    } else if (type === 'boss') {
      decor('decor_gate', 480, 280, 3);
      decor('decor_mourning_lantern', 80, 300, 3);
      decor('decor_mourning_lantern', 880, 300, 3);
      // 供桌放中央走道之外 (左墙根一带), 不挡 Boss 房中央。
      decor('decor_offering_table', 200, 488, 4);
      const smoke = this.add.image(200, 448, 'decor_smoke').setDepth(3);
      this.roomDecor.push(smoke);
      this.tweens.add({
        targets: smoke,
        y: 408,
        alpha: 0,
        duration: 4000,
        ease: 'Sine.easeOut',
        repeat: -1,
      });
    }
  }

  /** 商店房只摆柜台, 不卖货 (购买是切片 (c))。柜台无碰撞体, 不挡移动。 */
  private buildShopCounter(): void {
    const counter = this.add.image(200, 468, 'tile_counter').setDepth(4);
    const label = addPixelText(this, 200, 412, '柜台', {
      size: 12,
      color: PALETTE.candleLight,
      origin: 0.5,
    }).setDepth(5);
    this.roomDecor.push(counter, label);
  }

  /**
   * 清房入口统一且幂等: killEnemy 的「敌人死光」与零敌人房共用。
   * 非末槽 → 出门; 末槽 (roomIndex === slots.length - 1) → 整关结算。
   * (b) 追加 Boss 格后, 精英房自动恢复为普通推进, 无需改分流逻辑。
   */
  private markRoomCleared(): void {
    if (this.roomCleared) {
      return;
    }
    this.roomCleared = true;
    playSound('levelUp');
    if (this.roomIndex === this.chain.slots.length - 1) {
      this.stageCleared = true;
      this.clearEnemyBolts();
      this.clearCoinsText.setText(`铜钱总数：${this.coins}`);
      this.clearGroup.setVisible(true);
    } else if (this.currentTemplate.type === 'elite' && this.curse === null) {
      this.openCurseMenu();
    } else {
      this.showDoors();
    }
    this.updateHud();
  }

  private isNearShopCounter(): boolean {
    return (
      this.currentTemplate.type === 'shop' &&
      Math.abs(this.player.x - SHOP_COUNTER_X) <= SHOP_COUNTER_INTERACT_RADIUS
    );
  }

  private updateShopPrompt(): void {
    const visible =
      this.activeOverlay === null &&
      !this.stageCleared &&
      !this.gameOverTriggered &&
      this.isNearShopCounter();
    this.shopHintText.setVisible(visible);
  }

  private pauseForOverlay(kind: 'curse' | 'shop'): void {
    this.activeOverlay = kind;
    this.jHeld = false;
    this.jHoldStartMs = 0;
    this.hideChargeBar();
    this.physics.world.pause();
  }

  private closeOverlay(): void {
    for (const obj of this.overlayObjects) {
      obj.destroy();
    }
    this.overlayObjects = [];
    if (this.activeOverlay !== null) {
      this.activeOverlay = null;
      if (this.scene.isActive() && !this.hitstopEvent) {
        this.physics.world.resume();
      }
    }
  }

  private openCurseMenu(): void {
    if (this.activeOverlay !== null) {
      return;
    }
    this.pauseForOverlay('curse');

    const backdrop = this.add
      .rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, ARENA_WIDTH, ARENA_HEIGHT, 0x10182b, 0.72)
      .setDepth(27);
    const panel = this.add
      .rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 740, 320, 0x1b2a4a, 0.96)
      .setStrokeStyle(3, 0xc9973f)
      .setDepth(27);
    const title = addPixelText(this, ARENA_WIDTH / 2, 145, '霉运抉择（三选一）', {
      size: 24,
      color: PALETTE.lanternYellow,
      origin: 0.5,
    }).setDepth(28);
    const hint = addPixelText(this, ARENA_WIDTH / 2, 395, '按 1/2/3 或点击选择（整局生效，选完开门）', {
      size: 12,
      color: PALETTE.silverBlue,
      origin: 0.5,
    }).setDepth(28);
    this.overlayObjects.push(backdrop, panel, title, hint);

    CURSE_ORDER.forEach((curseId, idx) => {
      const def = CURSE_DEFS[curseId];
      const cx = ARENA_WIDTH / 2 + (idx - 1) * 228;
      const cy = 270;
      const card = this.add
        .rectangle(cx, cy, 210, 175, 0x2e2118, 0.95)
        .setStrokeStyle(2, def.borderHex)
        .setDepth(28)
        .setInteractive({ useHandCursor: true });
      const keyTag = addPixelText(this, cx, cy - 66, `[${idx + 1}] ${def.name}`, {
        size: 12,
        color: def.color,
        origin: 0.5,
      }).setDepth(29);
      const desc = addPixelText(this, cx, cy + 8, def.desc, {
        size: 12,
        color: PALETTE.candleLight,
        origin: 0.5,
        align: 1,
      }).setDepth(29);
      card.on('pointerdown', () => this.selectCurse(curseId));
      this.overlayObjects.push(card, keyTag, desc);
    });
  }

  private selectCurse(curseId: CurseId): void {
    if (this.activeOverlay !== 'curse' || this.curse !== null) {
      return;
    }
    this.curse = curseId;
    if (curseId === 'blood_pact') {
      this.maxHp = Math.max(1, this.maxHp - 5);
      this.hp = Math.max(1, Math.min(this.maxHp, this.hp - 5));
    }
    this.closeOverlay();
    playSound('levelUp');
    this.showDoors();
    this.updateHud();
  }

  private openShopMenu(): void {
    if (this.activeOverlay !== null) {
      return;
    }
    this.pauseForOverlay('shop');

    const backdrop = this.add
      .rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, ARENA_WIDTH, ARENA_HEIGHT, 0x10182b, 0.72)
      .setDepth(27);
    const panel = this.add
      .rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 740, 320, 0x1b2a4a, 0.96)
      .setStrokeStyle(3, 0xe8b34b)
      .setDepth(27);
    const title = addPixelText(this, ARENA_WIDTH / 2, 145, `夜巷当铺（铜钱：${this.coins}）`, {
      size: 24,
      color: PALETTE.lanternYellow,
      origin: 0.5,
    }).setDepth(28);
    const hint = addPixelText(this, ARENA_WIDTH / 2, 395, '按 1/2/3 或点击购买 · F/Esc 关闭', {
      size: 12,
      color: PALETTE.silverBlue,
      origin: 0.5,
    }).setDepth(28);
    this.overlayObjects.push(backdrop, panel, title, hint);

    SHOP_ITEMS.forEach((item, idx) => {
      const bought = this.shopPurchased.has(item.id);
      const affordable = !bought && this.coins >= item.cost;
      const cx = ARENA_WIDTH / 2 + (idx - 1) * 228;
      const cy = 270;
      const card = this.add
        .rectangle(cx, cy, 210, 175, 0x2e2118, affordable ? 0.95 : 0.45)
        .setStrokeStyle(2, affordable ? 0xe8b34b : 0x4e739e)
        .setDepth(28);
      if (affordable) {
        card.setInteractive({ useHandCursor: true });
        card.on('pointerdown', () => this.buyShopItem(item.id));
      }
      const nameText = addPixelText(this, cx, cy - 60, `[${idx + 1}] ${item.name}`, {
        size: 24,
        color: affordable ? PALETTE.paperWhite : PALETTE.silverBlue,
        origin: 0.5,
      })
        .setAlpha(affordable ? 1 : 0.5)
        .setDepth(29);
      const descText = addPixelText(this, cx, cy + 4, item.desc, {
        size: 12,
        color: affordable ? PALETTE.candleLight : PALETTE.silverBlue,
        origin: 0.5,
        align: 1,
      })
        .setAlpha(affordable ? 1 : 0.5)
        .setDepth(29);
      const statusText = addPixelText(
        this,
        cx,
        cy + 58,
        bought ? '已购' : affordable ? `${item.cost} 铜钱` : '铜钱不足',
        {
          size: 12,
          color: bought ? PALETTE.jadeGreen : affordable ? PALETTE.lanternYellow : PALETTE.vermilion,
          origin: 0.5,
        },
      ).setDepth(29);
      this.overlayObjects.push(card, nameText, descText, statusText);
    });
  }

  private buyShopItem(itemId: ShopItemId): void {
    if (this.activeOverlay !== 'shop' || this.shopPurchased.has(itemId)) {
      return;
    }
    const item = SHOP_ITEMS.find((it) => it.id === itemId);
    if (!item || this.coins < item.cost) {
      return;
    }
    this.coins -= item.cost;
    this.shopPurchased.add(item.id);
    if (item.id === 'heal') {
      this.hp = Math.min(this.maxHp, this.hp + 10);
    } else if (item.id === 'sword_up') {
      this.swordDamageBonus += 2;
    } else if (item.id === 'talisman_up') {
      this.talismanDamageBonus += 2;
    }
    playSound('levelUp');
    this.closeOverlay();
    this.updateHud();
  }

  /** 清房后出门: 门选的是下一个槽位 (§6: 清房 2 → 双门 → 选宝箱门 → 下一间是 chest)。
   * 下一槽是分支格时两扇 (标两个候选的奖励), 固定格时一扇 (「继续前进」)。
   * 只在非末槽调用, roomIndex + 1 一定存在。 */
  private showDoors(): void {
    if (this.doors.length > 0) {
      return;
    }
    const nextSlot = this.chain.slots[this.roomIndex + 1];
    const defs: { choice: number; label: string; x: number }[] =
      nextSlot.slot.kind === 'choice'
        ? [
            { choice: 0, label: nextSlot.candidates[0].label, x: 740 },
            { choice: 1, label: nextSlot.candidates[1].label, x: 830 },
          ]
        : [{ choice: 0, label: '继续前进', x: 785 }];
    for (const def of defs) {
      const y = SIDE_GROUND_Y - 45;
      // 门板像素图 64×96 居中盖在门区上 (depth 6); bg 矩形填充透明 (描边保留,
      // 金色加粗高亮逻辑不动); 触发区 60×90、中心 740/830、中立间隙 30px 不动。
      const bg = this.add
        .rectangle(def.x, y, 60, 90, 0x2e2118, 0)
        .setStrokeStyle(2, 0xe8b34b)
        .setDepth(9)
        .setInteractive({ useHandCursor: true });
      const img = this.add.image(def.x, y, 'tile_door').setDepth(6);
      const labelText = addPixelText(this, def.x, y - 58, def.label, {
        size: 12,
        color: PALETTE.paperWhite,
        origin: 0.5,
      }).setDepth(10);
      const zone = this.add.zone(def.x, y, 60, 90);
      this.physics.add.existing(zone, true);
      const bounds = new Phaser.Geom.Rectangle(def.x - 30, y - 45, 60, 90);
      const overlap = this.physics.add.overlap(this.player, zone, () => {
        this.onDoorOverlap(def.choice);
      });
      // 点击不走 bg 自身的 pointerdown: setInteractive 要到下一帧 preUpdate
      // 才并入输入插件的 _list, 门出现后 1 帧内的点击会被静默丢弃; 点门由
      // bindInputs 里的场景级 pointerdown 按实时门区统一处理, 门一出现即可点。
      this.doors.push({
        choice: def.choice,
        label: def.label,
        zone,
        bg,
        img,
        labelText,
        bounds,
        overlap,
        // 门生成时若玩家已在门区内, overlap 须等玩家先离开、再重新进入才启用;
        // 点击仍可作为显式选择。
        overlapArmed: !Phaser.Geom.Intersects.RectangleToRectangle(
          this.bodyBounds(this.player),
          bounds,
        ),
      });
    }
  }

  private hideDoors(): void {
    for (const door of this.doors) {
      door.overlap.destroy();
      door.zone.destroy();
      door.bg.destroy();
      door.img.destroy();
      door.labelText.destroy();
    }
    this.doors = [];
    this.doorHintText.setVisible(false);
  }

  private onDoorOverlap(choice: number): void {
    const door = this.doors.find((d) => d.choice === choice);
    if (!door || !door.overlapArmed || this.stageCleared || this.gameOverTriggered) {
      return;
    }
    // 双门（choice 格）不靠重叠进门：两扇门紧贴（区 [710,770]/[800,860]），
    // 走路从左向右必然先撞左门，右门永远走不到。双门只在玩家站进门区后按 E
    // 确认（见 updateBranchDoorPrompt），重叠回调到此为止；单门（「继续前进」）
    // 只有一个选择，走路即进保持不变。
    if (this.doors.length !== 1) {
      return;
    }
    // doorUsed 锁定由 submitDoor 统一判: 被挡下的重叠尝试也要进 submitDoor
    // 计数 (与点击同帧时, 两次尝试都应被观测到, 只第一次生效)。
    this.submitDoor(choice);
  }

  /**
   * 双门（choice 格）按键确认：每帧按身体盒与门区的严格相交算出玩家正站
   * 在哪扇门里（两门之间 30px 间隙里哪扇都不是），把那扇门的框加粗描金并
   * 在其上方显示「按 E 进入」；按 E 提交该门。走路穿过门区本身不触发——
   * 两扇门紧贴，走路即进会让右门永远到不了。单门（「继续前进」）走路即进，
   * 不走这里（提示与加粗只在双门时出现）。
   */
  private updateBranchDoorPrompt(): void {
    if (this.doors.length !== 2 || this.stageCleared || this.gameOverTriggered) {
      this.doorHintText.setVisible(false);
      for (const door of this.doors) {
        door.bg.setStrokeStyle(2, 0xe8b34b);
      }
      return;
    }
    const pBounds = this.bodyBounds(this.player);
    const active = this.doors.find((d) => rectsStrictlyOverlap(pBounds, d.bounds));
    for (const door of this.doors) {
      if (door === active) {
        door.bg.setStrokeStyle(3, 0xffd34d);
      } else {
        door.bg.setStrokeStyle(2, 0xe8b34b);
      }
    }
    if (!active) {
      this.doorHintText.setVisible(false);
      return;
    }
    this.doorHintText
      .setPosition(active.bounds.centerX, active.bounds.top - 38)
      .setVisible(true);
    if (Phaser.Input.Keyboard.JustDown(this.keyE)) {
      this.submitDoor(active.choice);
    }
  }

  /**
   * 选门唯一提交入口: 只写 chosen、置 doorUsed、挂 pendingTransition。
   * 销毁门、清理旧房、建新房全部推迟到 POST_UPDATE 执行点,
   * 不在物理回调内销毁任何东西。doorUsed 锁定后重复提交直接返回。
   */
  private submitDoor(choice: number): void {
    // 菜单打开期间（霉运/商店）禁止换房：商店房自动清房后已有单门，
    // 点门区否则会绕过暂停、直接换房并销毁菜单。
    if (this.activeOverlay !== null) {
      return;
    }
    this.doorSubmitAttempts += 1;
    if (this.doorUsed || this.stageCleared || this.gameOverTriggered) {
      return;
    }
    const nextSlot = this.chain.slots[this.roomIndex + 1];
    if (nextSlot && nextSlot.slot.kind === 'choice') {
      nextSlot.chosen = choice;
    }
    this.doorUsed = true;
    this.pendingTransition = { next: this.roomIndex + 1 };
  }

  /** POST_UPDATE 执行点: 执行挂起的换房 (与 PRE_RENDER/RENDER 钩子不冲突)。 */
  private processPendingTransition(): void {
    if (!this.pendingTransition) {
      return;
    }
    const next = this.pendingTransition.next;
    this.pendingTransition = null;
    if (this.gameOverTriggered || next >= this.chain.slots.length) {
      return;
    }
    this.enterRoom(next);
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
    this.swingHeavy = isHeavy;
    this.swingVisualTotal = this.swingVisualTimer;
    playSound('swing');

    const width = isHeavy ? SIDE_HEAVY_WIDTH : SIDE_SWING_WIDTH;
    const height = isHeavy ? SIDE_HEAVY_HEIGHT : SIDE_SWING_HEIGHT;
    const damage = this.getSwordDamage(isHeavy);
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
        this.heavyShakesApplied += 1;
      }
    }
  }

  private roundDmg(n: number): number {
    return Math.round(n * 10) / 10;
  }

  private getGlobalDamageMult(): number {
    return this.curse === 'blood_pact' ? 1.3 : 1;
  }

  private getSwordDamage(isHeavy: boolean): number {
    const base = (isHeavy ? SIDE_HEAVY_DAMAGE : SIDE_SWING_DAMAGE) + this.swordDamageBonus;
    const curseMult = this.curse === 'talisman_erode' ? 0.8 : 1;
    return this.roundDmg(base * curseMult * this.getGlobalDamageMult());
  }

  private getTalismanDamage(): number {
    const base = SIDE_TALISMAN_DAMAGE + this.talismanDamageBonus;
    const curseMult = this.curse === 'talisman_erode' ? 1.5 : 1;
    return this.roundDmg(base * curseMult * this.getGlobalDamageMult());
  }

  private getTalismanCooldown(): number {
    return SIDE_TALISMAN_COOLDOWN * (this.curse === 'talisman_erode' ? 0.8 : 1);
  }

  private getSwitchAttackDamage(): number {
    return this.roundDmg(SIDE_SWITCH_ATTACK_DAMAGE * this.getGlobalDamageMult());
  }

  private getDashDamage(): number {
    return this.roundDmg(SIDE_DASH_DAMAGE * this.getGlobalDamageMult());
  }

  private getEnemyContactDamage(base: number): number {
    return base + (this.curse === 'treasure_gather' ? 1 : 0);
  }

  private trySwitchForm(): void {
    if (this.switchCooldown > 0) {
      return;
    }
    this.form = this.form === 'sword' ? 'talisman' : 'sword';
    this.switchCooldown = SIDE_SWITCH_COOLDOWN;
    this.switchVisualTimer = SIDE_SWITCH_VISUAL_DURATION;

    // 切换取消当前动作：挥剑 / 符纸 / 蓄力 / 翻滚 / 疾攻全部取消
    this.swingVisualTimer = 0;
    this.talismanVisualTimer = 0;
    this.jHeld = false;
    this.jHoldStartMs = 0;
    this.hideChargeBar();
    if (this.rollTimer > 0) {
      this.rollTimer = 0;
      this.rollActiveThisFrame = false;
      this.player.setAlpha(1);
      this.player.setAngle(0);
    }
    // 翻滚刚结束的宽限帧（rollJustEnded）也要随切换取消，否则残留一帧无敌。
    this.rollJustEnded = false;
    if (this.dashTimer > 0 || this.dashCleanupPending) {
      this.dashTimer = 0;
      this.dashCleanupPending = false;
      this.dashHitIds.clear();
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      body.setAllowGravity(true);
      // 必须立即清水平速度：物理先于场景 update 更新，按 Q 后旧的 520 px/s
      // 疾攻速度否则还会被再用一步；同时撤回已挂起的末段命中结算。
      body.setVelocityX(0);
      this.player.setAngle(0);
    }
    this.cancelSquash();
    playSound('swing');

    // 换形攻击：短程冲击（伤害 3、范围约 70、前方扇形、只命中一次）
    const width = SIDE_SWITCH_ATTACK_RANGE;
    const height = SIDE_SWITCH_ATTACK_HEIGHT;
    const hitCenterX = this.player.x + this.facing * (width * 0.5);
    const hitCenterY = this.player.y;
    const hitbox = new Phaser.Geom.Rectangle(
      hitCenterX - width / 2,
      hitCenterY - height / 2,
      width,
      height,
    );

    const fan = this.add
      .image(hitCenterX, hitCenterY, 'slash_arc')
      .setFlipX(this.facing < 0)
      .setDisplaySize(width, height)
      .setTint(this.form === 'talisman' ? 0x4e7a5a : 0xe8b34b)
      .setDepth(12);
    fan.setAngle(-24 * this.facing);
    this.tweens.add({
      targets: fan,
      alpha: 0,
      angle: 24 * this.facing,
      scaleX: fan.scaleX * 1.15,
      duration: 160,
      onComplete: () => fan.destroy(),
    });

    const dmg = this.getSwitchAttackDamage();
    let hitCount = 0;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (Phaser.Geom.Intersects.RectangleToRectangle(hitbox, this.bodyBounds(enemy.sprite))) {
        hitCount += 1;
        const eBody = enemy.sprite.body as Phaser.Physics.Arcade.Body;
        const dir = eBody.center.x >= this.player.x ? 1 : -1;
        this.damageEnemy(enemy, i, dmg, dir, false, 0.16);
      }
    }

    if (hitCount > 0) {
      playSound('hit');
      this.applyHitstop(SIDE_LIGHT_HITSTOP_MS);
    }
    this.updateHud();
  }

  private performTalismanAttack(): void {
    this.talismanCooldown = this.getTalismanCooldown();
    this.talismanVisualTimer = SIDE_TALISMAN_VISUAL_DURATION;
    playSound('swing');

    const dir = this.facing;
    const startX = this.player.x + dir * 20;
    const startY = this.player.y - 2;
    const sprite = this.add
      .image(startX, startY, 'talisman_paper')
      .setFlipX(dir < 0)
      .setDisplaySize(32, 32)
      .setDepth(12);

    this.talismanProjectiles.push({
      sprite,
      dir,
      vx: dir * SIDE_TALISMAN_SPEED,
      rangeLeft: SIDE_TALISMAN_RANGE,
      damage: this.getTalismanDamage(),
    });
  }

  private updateTalismanProjectiles(dt: number): void {
    for (let i = this.talismanProjectiles.length - 1; i >= 0; i -= 1) {
      const proj = this.talismanProjectiles[i];
      const step = proj.vx * dt;
      proj.sprite.x += step;
      proj.rangeLeft -= Math.abs(step);

      if (
        proj.rangeLeft <= 0 ||
        proj.sprite.x < SIDE_WALL_WIDTH ||
        proj.sprite.x > ARENA_WIDTH - SIDE_WALL_WIDTH
      ) {
        proj.sprite.destroy();
        this.talismanProjectiles.splice(i, 1);
        continue;
      }

      const projBounds = new Phaser.Geom.Rectangle(
        proj.sprite.x - 10,
        proj.sprite.y - 8,
        20,
        16,
      );
      let hit = false;
      for (let j = this.enemies.length - 1; j >= 0; j -= 1) {
        const enemy = this.enemies[j];
        if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, this.bodyBounds(enemy.sprite))) {
          hit = true;
          this.spawnDashSparks(proj.sprite.x, proj.sprite.y);
          this.damageEnemy(enemy, j, proj.damage, proj.dir, false, 0.14);
          playSound('hit');
          this.applyHitstop(SIDE_LIGHT_HITSTOP_MS);
          break;
        }
      }

      if (hit) {
        proj.sprite.destroy();
        this.talismanProjectiles.splice(i, 1);
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
      if (this.scene.isActive() && this.activeOverlay === null) {
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
    enemy.stunTimer = stunDuration * enemy.stunScale;
    enemy.flashTimer = SIDE_HIT_FLASH_SECONDS;
    enemy.sprite.setTexture(enemyHitTextureKey(enemy.kind));

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
    const ey = Math.min(body.center.y, SIDE_GROUND_Y - 18);
    const dropCount = enemy.coinDrops + (this.curse === 'treasure_gather' ? 1 : 0);
    const oilCount =
      enemy.kind === 'elite'
        ? ELITE_LAMP_OIL_DROP
        : enemy.kind === 'boss'
          ? BOSS_LAMP_OIL_DROP
          : 0;
    const coreCount = enemy.kind === 'boss' ? BOSS_DEMON_CORE_DROP : 0;
    this.destroyEnemyUnit(enemy);
    this.enemies.splice(index, 1);

    this.kills += 1;
    playSound('kill');
    this.cameras.main.shake(SIDE_KILL_SHAKE_MS, SIDE_KILL_SHAKE_INTENSITY);
    this.spawnDeathBurst(ex, ey);
    for (let i = 0; i < dropCount; i += 1) {
      const offsetX = dropCount > 1 ? (i - (dropCount - 1) / 2) * 14 : 0;
      this.spawnCoinDrop(ex + offsetX, ey, 'coin');
    }
    for (let i = 0; i < oilCount; i += 1) {
      const offsetX = (i - (oilCount - 1) / 2) * 18 - 10;
      this.spawnCoinDrop(ex + offsetX, ey, 'oil');
    }
    for (let i = 0; i < coreCount; i += 1) {
      this.spawnCoinDrop(ex + 16, ey, 'core');
    }

    if (this.enemies.length === 0 && !this.roomCleared) {
      this.markRoomCleared();
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

  private spawnCoinDrop(x: number, y: number, kind: PickupKind = 'coin'): void {
    // Render-only scatter: the logical position stays at the drop point
    // (enemy feet) and only the visual arc moves, decaying back to zero.
    const scatter = computeSideCoinScatterVelocity();
    const texKey = kind === 'coin' ? 'coin_dart' : 'xp_orb';
    const coin = this.add
      .image(x, y + 10, texKey)
      .setDisplaySize(kind === 'coin' ? 24 : 20, kind === 'coin' ? 24 : 20)
      .setDepth(7);
    if (kind === 'oil') {
      coin.setTint(0xe8b34b);
    } else if (kind === 'core') {
      coin.setTint(0xb03a2e);
    }
    this.coinDrops.push({
      sprite: coin,
      kind,
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
    this.floatingNumbers.push(label);
    this.tweens.add({
      targets: label,
      y: y - 24,
      alpha: 0,
      duration: 420,
      onComplete: () => {
        const idx = this.floatingNumbers.indexOf(label);
        if (idx !== -1) {
          this.floatingNumbers.splice(idx, 1);
        }
        label.destroy();
      },
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
    this.hpText.setText(`生命：${this.hp}/${this.maxHp}`);
    this.enemiesText.setText(`心魔：${this.enemies.length}`);
    if (this.chain) {
      this.roomText.setText(`夜巷 ${this.roomIndex + 1}/${this.chain.slots.length}`);
    }
    this.coinsText.setText(`铜钱：${this.coins}`);
    this.pickupsHudText.setText(`油：${this.lampOil} 核：${this.demonCore}`);
    this.rollHudText.setText(
      this.rollCooldown <= 0 ? '翻身 可用' : `翻身 ${this.rollCooldown.toFixed(1)}s`,
    );
    this.dashHudText.setText(
      this.dashCooldown <= 0 ? '疾攻 可用' : `疾攻 ${this.dashCooldown.toFixed(1)}s`,
    );
    this.formHudText
      .setText(`形态：${this.form === 'sword' ? '剑' : '符'} [Q]`)
      .setTint(this.form === 'sword' ? 0xfbf6e9 : 0x4e7a5a);
    if (this.curse !== null) {
      const def = CURSE_DEFS[this.curse];
      this.curseHudText
        .setText(def.badge)
        .setTint(def.borderHex)
        .setVisible(true);
    } else {
      this.curseHudText.setVisible(false);
    }
    const boss = this.enemies.find((e) => e.kind === 'boss');
    if (boss) {
      const ratio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
      this.bossBarBg.setVisible(true);
      this.bossBarFill.setSize(Math.max(0, Math.round(312 * ratio)), 8).setVisible(true);
      this.bossBarLabel
        .setText(boss.phase === 2 ? '大心魔 · 狂暴' : '大心魔')
        .setVisible(true);
    } else {
      this.bossBarBg.setVisible(false);
      this.bossBarFill.setVisible(false);
      this.bossBarLabel.setVisible(false);
    }
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
      seed: this.runSeed,
    });
  }

  override update(_time: number, deltaMs: number): void {
    if (this.gameOverTriggered || this.physics.world.isPaused) {
      return;
    }

    // 门防误触: 未启用的 overlap 在玩家离开门区后启用 (再重新进入才触发)。
    for (const door of this.doors) {
      if (
        !door.overlapArmed &&
        !Phaser.Geom.Intersects.RectangleToRectangle(
          this.bodyBounds(this.player),
          door.bounds,
        )
      ) {
        door.overlapArmed = true;
      }
    }

    this.updateBranchDoorPrompt();

    const dt = Math.min(deltaMs / 1000, 0.05);
    this.swingCooldown = Math.max(0, this.swingCooldown - dt);
    this.swingVisualTimer = Math.max(0, this.swingVisualTimer - dt);
    this.switchCooldown = Math.max(0, this.switchCooldown - dt);
    this.switchVisualTimer = Math.max(0, this.switchVisualTimer - dt);
    this.talismanCooldown = Math.max(0, this.talismanCooldown - dt);
    this.talismanVisualTimer = Math.max(0, this.talismanVisualTimer - dt);
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
      // 换房会让挂起的回调失效 (代次对不上就跳过, 不对新房的敌人做判定)。
      const generation = this.roomGeneration;
      this.events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
        if (!this.gameOverTriggered && generation === this.roomGeneration) {
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

    // Hold-J: sword form charges; talisman form auto-fires on cooldown without charging
    if (this.form === 'talisman') {
      if (this.jHeld) {
        this.jHeld = false;
        this.jHoldStartMs = 0;
        this.hideChargeBar();
      }
      if (
        this.keyJ.isDown &&
        this.talismanCooldown <= 0 &&
        this.rollTimer <= 0 &&
        this.dashTimer <= 0 &&
        !this.stageCleared
      ) {
        this.performTalismanAttack();
      }
    } else if (this.jHeld) {
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
    this.updateTalismanProjectiles(dt);
    this.updateEnemies(dt);
    this.updateEnemyBolts(dt);
    this.updateCoinDrops(dt);
    this.updateShopPrompt();
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
        this.damageEnemy(enemy, i, this.getDashDamage(), this.dashDir, false, 0.15);
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
    // 优先级: 受击 > 翻滚 > 疾攻 > 挥剑 > 蓄力 > 空中 > 行走 > 待机。
    if (this.playerFlashTimer > 0) {
      this.player.setTexture('player_hurt_1');
      return;
    }
    if (this.rollTimer > 0) {
      // 翻滚 0.3s, 按剩余时间分三段。
      this.player.setTexture(
        this.rollTimer > 0.2 ? 'player_roll_1' : this.rollTimer > 0.1 ? 'player_roll_2' : 'player_roll_3',
      );
      return;
    }
    if (this.dashTimer > 0) {
      // 疾攻 0.18s, 每帧 0.09s。
      this.player.setTexture(this.dashTimer > 0.09 ? 'player_dash_1' : 'player_dash_2');
      return;
    }
    if (this.switchVisualTimer > 0) {
      // 换形 0.24s, 每帧 0.12s。
      const elapsed = Math.max(0, SIDE_SWITCH_VISUAL_DURATION - this.switchVisualTimer);
      this.player.setTexture(
        elapsed < SIDE_SWITCH_FRAME_SECONDS ? 'player_switch_1' : 'player_switch_2',
      );
      return;
    }
    if (this.talismanVisualTimer > 0) {
      // 符纸攻击 0.24s, 每帧 0.12s。
      const elapsed = Math.max(0, SIDE_TALISMAN_VISUAL_DURATION - this.talismanVisualTimer);
      this.player.setTexture(
        elapsed < SIDE_TALISMAN_FRAME_SECONDS ? 'player_talisman_1' : 'player_talisman_2',
      );
      return;
    }
    if (this.swingVisualTimer > 0) {
      // 按已流逝时间分三段 (轻击总 0.16s / 重击总 0.22s)。
      const elapsed = Math.max(0, this.swingVisualTotal - this.swingVisualTimer);
      const third = this.swingVisualTotal / 3;
      if (this.swingHeavy) {
        this.player.setTexture(
          elapsed < third ? 'player_heavy_1' : elapsed < third * 2 ? 'player_heavy_2' : 'player_heavy_3',
        );
      } else {
        this.player.setTexture(
          elapsed < third ? 'player_swing_1' : elapsed < third * 2 ? 'player_swing_2' : 'player_swing_3',
        );
      }
      return;
    }
    if (this.jHeld) {
      // 蓄力时长与蓄力条同一来源: performance.now() - jHoldStartMs
      // (jHoldStartMs 记的是 DOM keydown 的 event.timeStamp, 与 performance.now() 同源;
      // 绝不混用场景时钟 this.time.now)。
      const heldMs = performance.now() - this.jHoldStartMs;
      this.player.setTexture(heldMs < 250 ? 'player_charge_1' : 'player_charge_2');
      return;
    }
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (!body.blocked.down) {
      // 空中 (非挥剑/翻滚/疾攻): 起跳蹲 / 落地蹲按 squashPhase, 其余按 vy 方向。
      if (this.squashPhase === 'crouch') {
        this.player.setTexture('player_jump_1');
      } else if (this.squashPhase === 'land') {
        this.player.setTexture('player_jump_4');
      } else {
        this.player.setTexture(body.velocity.y < 0 ? 'player_jump_2' : 'player_jump_3');
      }
      return;
    }
    if (walkingOnGround) {
      this.walkTimer += dt;
      if (this.walkTimer >= 0.08) {
        this.walkTimer = 0;
        this.walkFrameIndex = (this.walkFrameIndex + 1) % 6;
      }
      this.player.setTexture(`player_walk_${this.walkFrameIndex + 1}`);
      return;
    }
    // 待机: 按场景时钟每 0.6s 交替 idle / idle_2。
    this.player.setTexture(Math.floor(this.time.now / 600) % 2 === 0 ? 'player_idle' : 'player_idle_2');
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
      }
      if (enemy.attackFlashTimer > 0) {
        enemy.attackFlashTimer = Math.max(0, enemy.attackFlashTimer - dt);
      }
      if (enemy.boltTimer > 0) {
        enemy.boltTimer = Math.max(0, enemy.boltTimer - dt);
      }

      const eBody = enemy.sprite.body as Phaser.Physics.Arcade.Body;
      const dx = this.player.x - enemy.sprite.x;
      const dy = this.player.y - enemy.sprite.y;
      // 近战追敌在身体盒边停手 (SIDE_ENEMY_CHASE_STANDOFF = 24): 走到
      // 24px 即停; 被冲锋/分离/玩家穿身顶进 24px 以内时, 退回 24px 而不是
      // 赖在玩家正中心 (旧死区 |dx| < 6 的隐形怪回归)。
      // dx === 0 时按 id 定边, 与分离的平局处理一致。
      let dir: number;
      if (Math.abs(dx) > SIDE_ENEMY_CHASE_STANDOFF) {
        dir = dx > 0 ? 1 : -1;
      } else if (Math.abs(dx) < SIDE_ENEMY_CHASE_STANDOFF) {
        dir = dx === 0 ? (enemy.id % 2 === 0 ? 1 : -1) : dx > 0 ? -1 : 1;
      } else {
        dir = 0;
      }

      if (enemy.frozen) {
        eBody.setVelocityX(0);
      } else if (enemy.stunTimer > 0) {
        enemy.stunTimer = Math.max(0, enemy.stunTimer - dt);
        if (enemy.stunTimer === 0) {
          eBody.setVelocityX(0);
        }
      } else {
        this.updateEnemyAi(enemy, eBody, dx, dy, dir, dt);
      }

      // 纹理优先级: 受击剪影 > Boss 发弹 > 冲锋 > 蓄势 > 攻击帧 > 行走帧。
      // 1.18 倍受击缩放只在行走帧恢复 (攻击闪光期间保持放大, 闪完回落)。
      const p2 = enemy.kind === 'boss' && enemy.phase === 2;
      if (enemy.flashTimer > 0) {
        enemy.sprite.setTexture(enemyHitTextureKey(enemy.kind));
      } else if (enemy.boltTimer > 0 && enemy.kind === 'boss') {
        enemy.sprite.setTexture(p2 ? 'enemy_boss_p2_bolt_1' : 'enemy_boss_bolt_1');
      } else if (enemy.lungeTimer > 0 && (enemy.kind === 'swift' || enemy.kind === 'boss')) {
        enemy.sprite.setTexture(
          enemy.kind === 'swift'
            ? 'enemy_swift_lunge_1'
            : p2
              ? 'enemy_boss_p2_lunge_1'
              : 'enemy_boss_lunge_1',
        );
      } else if (enemy.windupTimer > 0 && (enemy.kind === 'swift' || enemy.kind === 'boss')) {
        enemy.sprite.setTexture(
          enemy.kind === 'swift'
            ? 'enemy_swift_windup_1'
            : p2
              ? 'enemy_boss_p2_windup_1'
              : 'enemy_boss_windup_1',
        );
      } else if (enemy.attackFlashTimer > 0) {
        // 有专属攻击帧的种用攻击帧; swift/boss 保持剪影。
        if (
          enemy.kind === 'paper' ||
          enemy.kind === 'lantern' ||
          enemy.kind === 'shooter' ||
          enemy.kind === 'elite'
        ) {
          enemy.sprite.setTexture(`enemy_${enemy.kind}_attack_1`);
        } else {
          enemy.sprite.setTexture(enemyHitTextureKey(enemy.kind));
        }
      } else {
        // 行走帧: 按种类的帧时交替 walk_1/walk_2, 用场景时钟 + id 错相, 不新增逐敌计时器。
        const walkIntervalMs =
          enemy.kind === 'paper'
            ? 200
            : enemy.kind === 'lantern'
              ? 250
              : enemy.kind === 'swift'
                ? 120
                : enemy.kind === 'shooter'
                  ? 250
                  : enemy.kind === 'elite'
                    ? 300
                    : 450;
        const walkFrame =
          Math.floor((this.time.now + enemy.id * walkIntervalMs * 0.5) / walkIntervalMs) % 2 === 0
            ? 1
            : 2;
        enemy.sprite.setTexture(
          enemy.kind === 'boss'
            ? p2
              ? `enemy_boss_p2_walk_${walkFrame}`
              : `enemy_boss_walk_${walkFrame}`
            : `enemy_${enemy.kind}_walk_${walkFrame}`,
        );
        if (Math.abs(enemy.sprite.scaleX - enemy.baseScale) > 0.001) {
          this.setEnemyVisualScale(enemy.sprite, enemy.baseScale);
        }
      }

      if (
        !invulnerable &&
        enemy.contactCooldown <= 0 &&
        rectsStrictlyOverlap(pBounds, this.bodyBounds(enemy.sprite))
      ) {
        enemy.contactCooldown = enemy.attackCooldown;
        enemy.attackFlashTimer = 0.18;
        // 接触攻击即刻换攻击帧 (与下一帧纹理块的 attackFlash 分支一致):
        // 有专属攻击帧的种用攻击帧, swift/boss 用剪影; 1.18 倍缩放保持原样。
        if (
          enemy.kind === 'paper' ||
          enemy.kind === 'lantern' ||
          enemy.kind === 'shooter' ||
          enemy.kind === 'elite'
        ) {
          enemy.sprite.setTexture(`enemy_${enemy.kind}_attack_1`);
        } else {
          enemy.sprite.setTexture(enemyHitTextureKey(enemy.kind));
        }
        this.setEnemyVisualScale(enemy.sprite, enemy.baseScale * 1.18);
        this.spawnContactAttackSpark(
          (this.player.x + eBody.center.x) / 2,
          (this.player.y + eBody.center.y) / 2,
        );
        this.contactSignals.push({ enemyId: enemy.id, timeMs: Math.round(this.time.now) });
        if (this.contactSignals.length > 32) {
          this.contactSignals.shift();
        }
        this.applyPlayerDamage(this.getEnemyContactDamage(enemy.contactDamage));
        if (this.gameOverTriggered) {
          return;
        }
      }
    }

    this.applyEnemySeparation();
  }

  /**
   * 怪与怪水平分离: 同高度层敌人不许叠团遮挡, 硬直/冻结怪保持定身不参与分离。
   * 按可见宽度分 (不是身体盒 28px): 身体盒分开时精灵仍重叠 16px 以上,
   * 白底贴图糊成一团、画面只见 1 只 (live 回归, 见 tests/e2e/clump.spec.ts)。
   * 接触判定仍用身体盒, 伤害数值不动。
   */
  private applyEnemySeparation(): void {
    const minWallX = SIDE_WALL_WIDTH + 16;
    const maxWallX = ARENA_WIDTH - SIDE_WALL_WIDTH - 16;
    for (let pass = 0; pass < 4; pass += 1) {
      let moved = false;
      for (let i = 0; i < this.enemies.length; i += 1) {
        const a = this.enemies[i];
        const aPinned = a.frozen || a.stunTimer > 0;
        const ba = a.sprite.body as Phaser.Physics.Arcade.Body;
        for (let j = i + 1; j < this.enemies.length; j += 1) {
          const b = this.enemies[j];
          const bPinned = b.frozen || b.stunTimer > 0;
          if (aPinned && bPinned) {
            continue;
          }
          const bb = b.sprite.body as Phaser.Physics.Arcade.Body;
          // 垂直方向用实际盒边判断是否真正相交 (不固定 40): 两个 46 高的盒子
          // 中心高差 40–46px 时仍重叠, 旧阈值会漏掉。
          if (ba.bottom <= bb.top || bb.bottom <= ba.top) {
            continue;
          }
          // 视觉分离: 可见宽度之和的一半 + 空隙 + 余量。身体盒 (28px) 只管接触判定,
          // 怪与怪之间按这个距离站, 画面上才是分开的个体。余量让静息间距恒在
          // 验收阈值之上, 不被帧间逼近 (疾纸人冲锋约 3px/帧) 瞬时越线。
          const minSep =
            (a.visualWidth + b.visualWidth) * 0.5 +
            SIDE_ENEMY_VISUAL_GAP +
            SIDE_ENEMY_SEPARATION_MARGIN;
          const dx = ba.center.x - bb.center.x;
          const absDx = Math.abs(dx);
          if (absDx >= minSep) {
            continue;
          }
          const overlap = minSep - absDx;
          const pushDir = dx === 0 ? (a.id < b.id ? -1 : 1) : dx > 0 ? 1 : -1;
          const prevAx = a.sprite.x;
          const prevBx = b.sprite.x;

          if (aPinned) {
            b.sprite.x = Phaser.Math.Clamp(b.sprite.x - pushDir * overlap, minWallX, maxWallX);
            bb.updateFromGameObject();
            // 墙夹角: 单侧位移被墙截断、仍重叠时, 试另一侧 (硬直怪保持原位)。
            if (Math.abs(ba.center.x - bb.center.x) < minSep) {
              const otherSideX = Phaser.Math.Clamp(
                ba.center.x + pushDir * minSep,
                minWallX,
                maxWallX,
              );
              if (Math.abs(otherSideX - ba.center.x) >= minSep) {
                b.sprite.x = otherSideX;
                bb.updateFromGameObject();
              }
            }
          } else if (bPinned) {
            a.sprite.x = Phaser.Math.Clamp(a.sprite.x + pushDir * overlap, minWallX, maxWallX);
            ba.updateFromGameObject();
            if (Math.abs(ba.center.x - bb.center.x) < minSep) {
              const otherSideX = Phaser.Math.Clamp(
                bb.center.x - pushDir * minSep,
                minWallX,
                maxWallX,
              );
              if (Math.abs(otherSideX - bb.center.x) >= minSep) {
                a.sprite.x = otherSideX;
                ba.updateFromGameObject();
              }
            }
          } else {
            const half = overlap * 0.5;
            a.sprite.x = Phaser.Math.Clamp(prevAx + pushDir * half, minWallX, maxWallX);
            b.sprite.x = Phaser.Math.Clamp(prevBx - pushDir * half, minWallX, maxWallX);
            // 靠墙截断时把未推开的余量让位给另一侧, 防止贴墙长期重叠。
            const movedA = Math.abs(a.sprite.x - prevAx);
            const movedB = Math.abs(b.sprite.x - prevBx);
            const rem = overlap - movedA - movedB;
            if (rem > 0.01) {
              if (movedA < half - 0.01) {
                b.sprite.x = Phaser.Math.Clamp(b.sprite.x - pushDir * rem, minWallX, maxWallX);
              } else if (movedB < half - 0.01) {
                a.sprite.x = Phaser.Math.Clamp(a.sprite.x + pushDir * rem, minWallX, maxWallX);
              }
            }
          }

          ba.updateFromGameObject();
          bb.updateFromGameObject();
          if (pass === 0) {
            // 按实际位移方向加分离加速度: 越过硬直怪到另一侧时, 速度方向跟着走。
            if (!aPinned) {
              const dirA = Math.sign(a.sprite.x - prevAx) || pushDir;
              ba.setVelocityX(ba.velocity.x + dirA * 65);
            }
            if (!bPinned) {
              const dirB = Math.sign(b.sprite.x - prevBx) || -pushDir;
              bb.setVelocityX(bb.velocity.x + dirB * 65);
            }
          }
          moved = true;
        }
      }
      if (!moved) {
        break;
      }
    }
  }

  private updateEnemyAi(
    enemy: EnemyUnit,
    eBody: Phaser.Physics.Arcade.Body,
    dx: number,
    dy: number,
    dir: number,
    dt: number,
  ): void {
    const faceDir = dx >= 0 ? 1 : -1;
    if (enemy.kind === 'swift') {
      enemy.aiTimer = Math.max(0, enemy.aiTimer - dt);
      if (enemy.lungeTimer > 0) {
        enemy.lungeTimer = Math.max(0, enemy.lungeTimer - dt);
        eBody.setVelocityX(enemy.lungeDir * enemy.speed * 2.2);
        enemy.sprite.setFlipX(enemy.lungeDir < 0);
        return;
      }
      if (enemy.windupTimer > 0) {
        enemy.windupTimer = Math.max(0, enemy.windupTimer - dt);
        eBody.setVelocityX(0);
        enemy.sprite.setFlipX(faceDir < 0);
        if (enemy.windupTimer === 0) {
          enemy.lungeTimer = 0.28;
          enemy.aiTimer = 2.2;
          enemy.lungeDir = faceDir;
        }
        return;
      }
      if (Math.abs(dx) < 180 && Math.abs(dy) < 48 && enemy.aiTimer <= 0) {
        enemy.windupTimer = 0.25;
        eBody.setVelocityX(0);
        return;
      }
      eBody.setVelocityX(dir * enemy.speed);
      if (dir !== 0) {
        // 退回停手距离时仍面向玩家 (dir 此时背向玩家)。
        enemy.sprite.setFlipX(faceDir < 0);
      }
      return;
    }

    if (enemy.kind === 'shooter') {
      enemy.aiTimer = Math.max(0, enemy.aiTimer - dt);
      const dist = Math.abs(dx);
      if (dist > SHOOTER_RANGE) {
        eBody.setVelocityX(faceDir * enemy.speed);
      } else if (dist < SHOOTER_RETREAT_DIST) {
        eBody.setVelocityX(-faceDir * enemy.speed);
      } else {
        eBody.setVelocityX(0);
      }
      enemy.sprite.setFlipX(faceDir < 0);

      if (enemy.aiTimer <= 0 && dist <= SHOOTER_RANGE + 80) {
        enemy.aiTimer = SHOOTER_FIRE_COOLDOWN;
        enemy.attackFlashTimer = 0.14;
        const angle = Math.atan2(this.player.y - eBody.center.y, this.player.x - eBody.center.x);
        this.spawnEnemyBolt(
          eBody.center.x,
          eBody.center.y,
          Math.cos(angle) * SHOOTER_BOLT_SPEED,
          Math.sin(angle) * SHOOTER_BOLT_SPEED,
          SHOOTER_BOLT_DAMAGE,
        );
      }
      return;
    }

    if (enemy.kind === 'boss') {
      if (enemy.phase === 1 && enemy.hp <= enemy.maxHp * 0.5) {
        enemy.phase = 2;
        this.spawnFloatingNumber(eBody.center.x, eBody.center.y - 38, '狂暴', PALETTE.vermilion);
        this.cameras.main.shake(100, 0.006, true);
      }
      enemy.aiTimer = Math.max(0, enemy.aiTimer - dt);
      const moveSpeed = enemy.phase === 2 ? enemy.speed * 1.15 : enemy.speed;

      if (enemy.lungeTimer > 0) {
        enemy.lungeTimer = Math.max(0, enemy.lungeTimer - dt);
        eBody.setVelocityX(enemy.lungeDir * moveSpeed * 1.85);
        enemy.sprite.setFlipX(enemy.lungeDir < 0);
        return;
      }
      if (enemy.windupTimer > 0) {
        enemy.windupTimer = Math.max(0, enemy.windupTimer - dt);
        eBody.setVelocityX(0);
        enemy.sprite.setFlipX(faceDir < 0);
        if (enemy.windupTimer === 0) {
          if (Math.abs(dx) > 140 || (enemy.phase === 2 && Math.abs(dx) > 100)) {
            const baseAngle = Math.atan2(
              this.player.y - eBody.center.y,
              this.player.x - eBody.center.x,
            );
            const offsets = enemy.phase === 2 ? [-0.22, 0, 0.22] : [0];
            for (const off of offsets) {
              const a = baseAngle + off;
              this.spawnEnemyBolt(
                eBody.center.x,
                eBody.center.y,
                Math.cos(a) * (SHOOTER_BOLT_SPEED * 1.2),
                Math.sin(a) * (SHOOTER_BOLT_SPEED * 1.2),
                1,
              );
            }
            // 发弹帧 (纯视觉计时器, updateEnemies 里递减)。
            enemy.boltTimer = 0.2;
          } else {
            enemy.lungeTimer = 0.35;
            enemy.lungeDir = faceDir;
          }
          enemy.aiTimer = enemy.phase === 2 ? 2.4 : 3.2;
        }
        return;
      }
      if (enemy.aiTimer <= 0) {
        enemy.windupTimer = 0.4;
        eBody.setVelocityX(0);
        return;
      }
      eBody.setVelocityX(dir * moveSpeed);
      if (dir !== 0) {
        // 退回停手距离时仍面向玩家 (dir 此时背向玩家)。
        enemy.sprite.setFlipX(faceDir < 0);
      }
      return;
    }

    // paper, lantern, elite: 稳定追击玩家
    eBody.setVelocityX(dir * enemy.speed);
    if (dir !== 0) {
      // 退回停手距离时仍面向玩家 (dir 此时背向玩家)。
      enemy.sprite.setFlipX(faceDir < 0);
    }
  }

  private spawnEnemyBolt(x: number, y: number, vx: number, vy: number, damage: number): void {
    const sprite = this.physics.add.sprite(x, y, 'enemy_bolt').setDepth(9);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setSize(12, 12).setOffset(26, 26);
    body.setVelocity(vx, vy);
    this.enemyBolts.push({ sprite, vx, vy, damage, life: 4.5 });
  }

  private updateEnemyBolts(dt: number): void {
    if (this.stageCleared || this.gameOverTriggered) {
      return;
    }
    const pBounds = this.bodyBounds(this.player);
    for (let i = this.enemyBolts.length - 1; i >= 0; i -= 1) {
      const bolt = this.enemyBolts[i];
      bolt.life -= dt;
      const sx = bolt.sprite.x;
      const sy = bolt.sprite.y;
      if (
        bolt.life <= 0 ||
        sx < SIDE_WALL_WIDTH ||
        sx > ARENA_WIDTH - SIDE_WALL_WIDTH ||
        sy < HUD_HEIGHT ||
        sy > SIDE_GROUND_Y
      ) {
        bolt.sprite.destroy();
        this.enemyBolts.splice(i, 1);
        continue;
      }
      if (
        !this.rollActiveThisFrame &&
        Phaser.Geom.Intersects.RectangleToRectangle(pBounds, this.bodyBounds(bolt.sprite))
      ) {
        const dmg = bolt.damage;
        bolt.sprite.destroy();
        this.enemyBolts.splice(i, 1);
        this.applyPlayerDamage(dmg);
        if (this.gameOverTriggered) {
          return;
        }
      }
    }
  }

  private spawnContactAttackSpark(x: number, y: number): void {
    for (let i = 0; i < 4; i += 1) {
      const angle = (Math.PI * 2 * i) / 4 + Math.PI / 4;
      const p = this.add.rectangle(x, y, 4, 4, 0xb03a2e).setDepth(14);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * 14,
        y: y + Math.sin(angle) * 14,
        alpha: 0,
        duration: 160,
        onComplete: () => p.destroy(),
      });
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
        if (drop.kind === 'coin') {
          this.coins += 1;
        } else if (drop.kind === 'oil') {
          this.lampOil += 1;
        } else {
          this.demonCore += 1;
        }
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

  /** 缩放敌人显示但保持物理盒恒为 28x46 (精英/Boss/命中闪不放大碰撞盒)。 */
  private setEnemyVisualScale(sprite: Phaser.Physics.Arcade.Sprite, scale: number): void {
    sprite.setScale(scale);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    const comp = compensateEnemyBodyScale(scale);
    body.setSize(comp.width, comp.height);
    body.setOffset(comp.offsetX, comp.offsetY);
    body.updateBounds();
  }

  private clearEnemyBolts(): void {
    for (const bolt of this.enemyBolts) {
      bolt.sprite.destroy();
    }
    this.enemyBolts = [];
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
