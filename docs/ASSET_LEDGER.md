# ASSET_LEDGER — 横板版像素美术台账

美术返工（itch.io Demo，2026-11-28）：全部手画像素点，AI 生图不用作正式像素素材。
16 色主调色板（`src/game/pixelart.ts` 的 `PIXEL_PALETTE`），单图 ≤12 色。
网格 32×32、每格 2px；矩形纹理按格数标注（行×列）。玩家全部帧脚底行 26、朝右画。
字库：`src/data/pixel-font.json`，Fusion Pixel 12px，828 字形（2026-11-28 补 狂/暴 2 字）。

修订轮（2026-11-28）：删 10 键（双形态/符纸 5 + Boss P2 手画 5）、补 6 键（另 `bg_sky`/`bg_houses` 改为 480×32 格长条）、平台 1 键拆 3 键；现总数 **95 键**（实测 `src/data/pixelart.ts` 的 `GAME_PIXEL_ART`，main 22 键 + 本轮新增 73 键）。

## 本轮新增（73 键）

| 键 | 格数（行×列） | 色数 | 用途 |
|---|---|---|---|
| `bg_houses` | 32x480 | 7 | L1 中景：民居屋檐+亮窗+烟囱（480×32 格长条，横向一带使用） |
| `bg_moon` | 8x8 | 3 | L0 月亮（单独一张，16×16 显示，中心 y 52） |
| `bg_sky` | 32x480 | 4 | L0 远景：夜空+远处屋顶剪影（480×32 格长条，横向一带使用） |
| `decor_altar` | 12x12 | 6 | 精英房：黑坛 |
| `decor_basket` | 8x12 | 3 | 战斗房：竹筐 |
| `decor_candle` | 16x8 | 6 | 烛台（宝箱/商店/精英房） |
| `decor_clothesline` | 8x32 | 7 | 战斗房：晾衣绳+旧衣 |
| `decor_cloud` | 8x32 | 2 | L0 云烟（横向平铺漂移，边缘淡出） |
| `decor_clutter` | 4x32 | 6 | 战斗房：地面杂物（碎瓦/菜叶/纸屑，4 行高） |
| `decor_crate` | 12x12 | 4 | 战斗房：木箱 |
| `decor_eaves` | 16x32 | 4 | 前景顶檐（depth 11，横向平铺） |
| `decor_gate` | 32x24 | 5 | Boss 房：朱红大门（背景墙面中央） |
| `decor_mask` | 16x16 | 5 | 精英房：墙面大魔面具 |
| `decor_mourning_lantern` | 16x10 | 3 | Boss 房：白色丧灯 |
| `decor_notice` | 12x10 | 5 | 战斗房：墙面旧告示（无字） |
| `decor_offering_table` | 12x20 | 6 | Boss 房：供桌（中央走道之外） |
| `decor_pier` | 16x12 | 4 | 入口房：石门墩（左墙根） |
| `decor_rope` | 8x32 | 4 | 前景悬索（depth 11，横向平铺，垂挂小纸符） |
| `decor_shadow_wall` | 24x16 | 6 | 入口房：影壁半幅（右墙根） |
| `decor_smoke` | 16x6 | 2 | Boss 房：香炉青烟（上飘 tween） |
| `decor_stall` | 16x16 | 7 | 战斗房：摊位布棚一角 |
| `decor_talisman` | 16x10 | 4 | 精英房：悬挂符纸（朱红符文） |
| `enemy_boss_bolt_1` | 32x32 | 8 | 大心魔发弹帧 |
| `enemy_boss_lunge_1` | 32x32 | 7 | 大心魔冲锋帧 |
| `enemy_boss_walk_1` | 32x32 | 7 | 大心魔行走帧 1 |
| `enemy_boss_walk_2` | 32x32 | 7 | 大心魔行走帧 2 |
| `enemy_boss_windup_1` | 32x32 | 8 | 大心魔蓄势帧 |
| `enemy_elite_attack_1` | 32x32 | 5 | 大魔面攻击帧（下砸） |
| `enemy_elite_walk_1` | 32x32 | 5 | 大魔面行走帧 1 |
| `enemy_elite_walk_2` | 32x32 | 5 | 大魔面行走帧 2 |
| `enemy_lantern_attack_1` | 32x32 | 7 | 灯笼怪攻击帧（灯火爆亮） |
| `enemy_lantern_walk_1` | 32x32 | 5 | 灯笼怪行走帧 1 |
| `enemy_lantern_walk_2` | 32x32 | 5 | 灯笼怪行走帧 2 |
| `enemy_paper_attack_1` | 32x32 | 5 | 心魔攻击帧（扑抓） |
| `enemy_paper_walk_1` | 32x32 | 5 | 心魔行走帧 1 |
| `enemy_paper_walk_2` | 32x32 | 5 | 心魔行走帧 2 |
| `enemy_shooter_attack_1` | 32x32 | 9 | 远灯笼攻击帧（举灯） |
| `enemy_shooter_walk_1` | 32x32 | 9 | 远灯笼行走帧 1 |
| `enemy_shooter_walk_2` | 32x32 | 9 | 远灯笼行走帧 2 |
| `enemy_swift_lunge_1` | 32x32 | 6 | 疾纸人冲锋帧 |
| `enemy_swift_walk_1` | 32x32 | 6 | 疾纸人行走帧 1 |
| `enemy_swift_walk_2` | 32x32 | 6 | 疾纸人行走帧 2 |
| `enemy_swift_windup_1` | 32x32 | 4 | 疾纸人蓄势帧 |
| `player_charge_1` | 32x32 | 11 | 玩家蓄力帧 1 |
| `player_charge_2` | 32x32 | 11 | 玩家蓄力帧 2（蓄满亮起） |
| `player_dash_1` | 32x32 | 12 | 玩家疾攻帧 1（前倾） |
| `player_dash_2` | 32x32 | 11 | 玩家疾攻帧 2（伸展） |
| `player_heavy_1` | 32x32 | 11 | 玩家重击帧 1（举剑） |
| `player_heavy_2` | 32x32 | 12 | 玩家重击帧 2（下劈） |
| `player_heavy_3` | 32x32 | 11 | 玩家重击帧 3（收剑） |
| `player_hurt_1` | 32x32 | 12 | 玩家受击帧（后仰） |
| `player_idle_2` | 32x32 | 11 | 玩家待机帧 2（呼吸帧） |
| `player_jump_1` | 32x32 | 11 | 玩家跳帧 1（起跳蹲） |
| `player_jump_2` | 32x32 | 11 | 玩家跳帧 2（上升） |
| `player_jump_3` | 32x32 | 11 | 玩家跳帧 3（下落） |
| `player_jump_4` | 32x32 | 11 | 玩家跳帧 4（落地蹲） |
| `player_roll_1` | 32x32 | 10 | 玩家翻滚帧 1（收身） |
| `player_roll_2` | 32x32 | 7 | 玩家翻滚帧 2（团球） |
| `player_roll_3` | 32x32 | 11 | 玩家翻滚帧 3（起身） |
| `player_swing_3` | 32x32 | 11 | 玩家挥剑帧 3（收势） |
| `player_walk_3` | 32x32 | 11 | 玩家跑帧 3 |
| `player_walk_4` | 32x32 | 11 | 玩家跑帧 4 |
| `player_walk_5` | 32x32 | 11 | 玩家跑帧 5 |
| `player_walk_6` | 32x32 | 11 | 玩家跑帧 6 |
| `sign_alley` | 16x32 | 4 | 入口房：木牌「夜巷」二字（字取自像素字库字形） |
| `sign_medicine` | 16x16 | 4 | 商店房：木牌「药」单字 |
| `tile_chest` | 24x32 | 7 | 宝箱：32x24 格，64x48 显示（宝箱房） |
| `tile_counter` | 32x64 | 5 | 药铺柜台：64x32 格，128x64 显示（柜面抽屉格阵） |
| `tile_door` | 48x32 | 5 | 门：32x48 格，64x96 显示（视觉尺寸；触发区仍 60x90） |
| `tile_ground` | 20x32 | 5 | 地面：32x20 格横向平铺（top y=500） |
| `tile_platform_left` | 8x32 | 4 | 平台左端瓦片：32x8 格（顶面 2 格木色、下沿砖影） |
| `tile_platform_mid` | 8x32 | 4 | 平台中段瓦片：32x8 格（横向平铺，余数裁切） |
| `tile_platform_right` | 8x32 | 4 | 平台右端瓦片：32x8 格（顶面 2 格木色、下沿砖影） |

## 本轮原位重画（11 键，键名不变）

| 键 | 格数（行×列） | 色数 | 用途 |
|---|---|---|---|
| `enemy_boss` | 32x32 | 7 | 大心魔基准帧 |
| `enemy_elite` | 32x32 | 5 | 大魔面基准帧（冷色） |
| `enemy_lantern` | 32x32 | 5 | 灯笼怪基准帧 |
| `enemy_paper` | 32x32 | 5 | 心魔待机/行走基准帧（侧面） |
| `enemy_shooter` | 32x32 | 9 | 远灯笼基准帧 |
| `enemy_swift` | 32x32 | 6 | 疾纸人基准帧 |
| `player_idle` | 32x32 | 11 | 玩家待机帧 1（侧面朝右） |
| `player_swing_1` | 32x32 | 10 | 玩家挥剑帧 1（蓄势） |
| `player_swing_2` | 32x32 | 11 | 玩家挥剑帧 2（挥出） |
| `player_walk_1` | 32x32 | 11 | 玩家跑帧 1 |
| `player_walk_2` | 32x32 | 11 | 玩家跑帧 2 |

## 修订轮重画（23 键，v1 版作废）

修订轮（2026-11-28）把以下 23 键全部重画，v1 版（`art-out/` 中间产物）作废，以现 `src/data/pixelart.ts` 为准。六种怪的走帧 + 攻击帧共 21 键：paper 3、lantern 3、swift 4、shooter 3、elite 3、boss 5；另背景灯笼两件降调。

| 键 | 格数（行×列） | 色数 | 用途 |
|---|---|---|---|
| `enemy_boss_bolt_1` | 32x32 | 8 | 大心魔发弹帧（重画） |
| `enemy_boss_lunge_1` | 32x32 | 7 | 大心魔冲锋帧（重画） |
| `enemy_boss_walk_1` | 32x32 | 7 | 大心魔行走帧 1（重画） |
| `enemy_boss_walk_2` | 32x32 | 7 | 大心魔行走帧 2（重画） |
| `enemy_boss_windup_1` | 32x32 | 8 | 大心魔蓄势帧（重画） |
| `enemy_elite_attack_1` | 32x32 | 5 | 大魔面攻击帧（重画） |
| `enemy_elite_walk_1` | 32x32 | 5 | 大魔面行走帧 1（重画） |
| `enemy_elite_walk_2` | 32x32 | 5 | 大魔面行走帧 2（重画） |
| `enemy_lantern_attack_1` | 32x32 | 7 | 灯笼怪攻击帧（重画） |
| `enemy_lantern_walk_1` | 32x32 | 5 | 灯笼怪行走帧 1（重画） |
| `enemy_lantern_walk_2` | 32x32 | 5 | 灯笼怪行走帧 2（重画） |
| `enemy_paper_attack_1` | 32x32 | 5 | 心魔攻击帧（重画） |
| `enemy_paper_walk_1` | 32x32 | 5 | 心魔行走帧 1（重画） |
| `enemy_paper_walk_2` | 32x32 | 5 | 心魔行走帧 2（重画） |
| `enemy_shooter_attack_1` | 32x32 | 9 | 远灯笼攻击帧（重画） |
| `enemy_shooter_walk_1` | 32x32 | 9 | 远灯笼行走帧 1（重画） |
| `enemy_shooter_walk_2` | 32x32 | 9 | 远灯笼行走帧 2（重画） |
| `enemy_swift_lunge_1` | 32x32 | 6 | 疾纸人冲锋帧（重画） |
| `enemy_swift_walk_1` | 32x32 | 6 | 疾纸人行走帧 1（重画） |
| `enemy_swift_walk_2` | 32x32 | 6 | 疾纸人行走帧 2（重画） |
| `enemy_swift_windup_1` | 32x32 | 4 | 疾纸人蓄势帧（重画） |
| `wall_lantern` | 32x32 | 7 | 墙挂灯笼（L2/L3，±2px 缓摆；降调：8 色→7 色） |
| `lantern_glow` | 32x32 | 2 | 灯笼光晕（L2；降调：两档亮色各降一档 4/5→3/4，仍 2 色） |

## 沿用未动的既有纹理

| 键 | 格数（行×列） | 色数 | 用途 |
|---|---|---|---|
| `alley_corner` | 32x32 | 2 | 四角暗角（L2/L3） |
| `alley_tile` | 32x32 | 3 | 青砖地面平铺（已退为 L2 墙面纹理，不再当地面） |
| `alley_wall_tile` | 32x32 | 6 | 两侧墙体（L2） |
| `coin_dart` | 32x32 | 4 | 铜钱（拾取/飞散） |
| `enemy_bolt` | 32x32 | 5 | 敌弹（远灯笼/Boss 共用） |
| `lantern_ring_1` | 32x32 | 4 | 灯笼火圈帧 1（俯视角遗留） |
| `lantern_ring_2` | 32x32 | 4 | 灯笼火圈帧 2（俯视角遗留） |
| `slash_arc` | 32x32 | 4 | 剑光（挥剑扫动） |
| `xp_orb` | 32x32 | 4 | 经验珠（俯视角遗留，横板未用） |

## 备注

- `SIDE_ENEMY_VISUAL_WIDTH`（`balance.ts`）未改：新精灵可见宽全部窄于旧值，常量留作保守上限，怪-怪分离行为与 live 验收一致。
- 门视觉 64×96、触发区 60×90 解耦：双门中心 740/830、中立间隙 30px 不变。
- 双形态切换帧与符纸攻击帧（`player_switch_1/2`、`player_talisman_1/2`、`talisman_paper`）已删：修订轮 v2 已砍，等 (c) 定案再画。
- Boss 阶段 2 的 5 个手画键（`enemy_boss_p2_walk_1/2`、`enemy_boss_p2_windup_1`、`enemy_boss_p2_bolt_1`、`enemy_boss_p2_lunge_1`）已删：阶段 2 走代码换色（见 `art-design.md` §1.2），注册时无对应数据键即为真实换色路径。
- 平台 1 键拆为左端/中段/右端 3 键（各 32×8 格）：平台宽 180–260px 不是 64 的整数倍，中段平铺、余数用中段裁切，左端与右端完整保留。
- `bg_sky`/`bg_houses` 横向一带使用（480×32 格，960×64 显示）：满铺会重复月亮、民居层会盖住天空层；两带下方露出的底色 #10182B 与天空素色同色。
- 商店房药柜抽屉墙无独立纹理：接线时用小矩形格阵画在右侧墙面带；悬挂药草束无纹理，已跳过。
