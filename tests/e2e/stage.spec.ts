import { expect, test } from '@playwright/test';
import {
  chainSignature,
  generateStage,
  jumpPlan,
  ROOM_TEMPLATES,
} from '../../src/game/rooms.ts';
import {
  advanceRoom,
  clearCurrentRoom,
  clearStage,
  clickDoor,
  clickGamePoint,
  dispatchTwoDoorClicks,
  getState,
  pressDoorConfirm,
  startGame,
  waitForDoorsRegistered,
  waitForRoomIndex,
  walkRightToX,
} from './helpers.ts';

const SEED = 20261127;

test.describe('Night Alley S2 Stage', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      throw err;
    });
  });

  test('full run, chest route: rooms progress 1-6, shop auto-clears, boss clears the stage', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await startGame(page, SEED);
    const expected = chainSignature(generateStage(SEED));

    let state = await getState(page);
    expect(state.seed).toBe(SEED);
    expect(state.chainSignature).toBe(expected);
    expect(state.roomIndex).toBe(0);
    expect(state.roomType).toBe('entrance');
    expect(state.roomCount).toBe(6);

    // Room 1 (entrance, 3 demons) -> single door -> room 2.
    await clearCurrentRoom(page);
    state = await getState(page);
    expect(state.roomCleared).toBe(true);
    expect(state.doors).toHaveLength(1);
    expect(state.doors[0].label).toBe('继续前进');
    await advanceRoom(page, 0);
    state = await getState(page);
    expect(state.roomIndex).toBe(1);
    expect(state.roomType).toBe('combat');

    // Room 2 (combat) -> two doors; pick the right one (chest).
    await clearCurrentRoom(page);
    state = await getState(page);
    expect(state.doors).toHaveLength(2);
    expect(state.doors[0].label).not.toBe(state.doors[1].label);
    await clickDoor(page, 1);
    await waitForRoomIndex(page, 2);
    state = await getState(page);
    expect(state.roomType).toBe('chest');
    expect(state.enemiesAlive).toBe(0);

    // Room 3 (chest) has no enemies: it clears on entry.
    expect(state.roomCleared).toBe(true);
    await advanceRoom(page, 0);
    state = await getState(page);
    expect(state.roomIndex).toBe(3);
    expect(state.roomType).toBe('shop');

    // Room 4 (shop) has no enemies either: it clears on entry.
    expect(state.roomCleared).toBe(true);
    await advanceRoom(page, 0);
    state = await getState(page);
    expect(state.roomIndex).toBe(4);
    expect(state.roomType).toBe('elite');

    // Room 5 (elite) -> single door -> room 6 (boss).
    await clearCurrentRoom(page);
    state = await getState(page);
    expect(state.roomCleared).toBe(true);
    expect(state.stageCleared).toBe(false);
    expect(state.doors).toHaveLength(1);
    await advanceRoom(page, 0);
    state = await getState(page);
    expect(state.roomIndex).toBe(5);
    expect(state.roomType).toBe('boss');

    // Room 6 (boss) -> stage cleared banner.
    await clearCurrentRoom(page);
    state = await getState(page);
    expect(state.stageCleared).toBe(true);
    expect(state.enemiesAlive).toBe(0);
  });

  test('full run, combat route: picking the left branch door enters a combat room', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await startGame(page, SEED);

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    const state = await getState(page);
    expect(state.doors).toHaveLength(2);
    await clickDoor(page, 0);
    await waitForRoomIndex(page, 2);
    const after = await getState(page);
    expect(after.roomType).toBe('combat');
    expect(after.enemiesAlive).toBeGreaterThan(0);

    await clearStage(page, 0);
    const final = await getState(page);
    expect(final.stageCleared).toBe(true);
  });

  test('branch doors enter different templates: left door enters the combat candidate, right door the chest candidate', async ({
    page,
  }) => {
    test.setTimeout(120000);
    // Same seed, two runs: the branch slot pre-draws one combat and one
    // chest candidate; each door must enter its own candidate's template,
    // not the same layout twice (live report: "两扇门进的都是同一布局的第 3 间房").
    const chain = generateStage(SEED);
    const branch = chain.slots[2];
    expect(branch.slot.kind).toBe('choice');
    expect(branch.candidates).toHaveLength(2);
    expect(branch.candidates[0].id).not.toBe(branch.candidates[1].id);

    // Left door (choice 0) -> combat candidate.
    await startGame(page, SEED);
    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    let state = await getState(page);
    expect(state.doors).toHaveLength(2);
    expect(state.doors[0].label).toBe(branch.candidates[0].label);
    expect(state.doors[1].label).toBe(branch.candidates[1].label);
    await clickDoor(page, 0);
    await waitForRoomIndex(page, 2);
    state = await getState(page);
    expect(state.roomType).toBe('combat');
    expect(state.roomTemplateId).toBe(branch.candidates[0].id);

    // Same seed, fresh run: right door (choice 1) -> chest candidate.
    await startGame(page, SEED);
    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    state = await getState(page);
    expect(state.doors).toHaveLength(2);
    await clickDoor(page, 1);
    await waitForRoomIndex(page, 2);
    state = await getState(page);
    expect(state.roomType).toBe('chest');
    expect(state.roomTemplateId).toBe(branch.candidates[1].id);
  });

  test('door does not auto-fire when the player stands in the doorway at clear time', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    // Stand where the single door will appear, then clear the room.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(785, 478);
    });
    await clearCurrentRoom(page);
    const cleared = await getState(page);
    expect(cleared.roomCleared).toBe(true);
    expect(cleared.doors).toHaveLength(1);

    // Several physics steps pass with the player still inside the doorway.
    await page.waitForTimeout(500);
    const still = await getState(page);
    expect(still.roomIndex).toBe(0);

    // Walk out to the left, then back in: exactly one room advance.
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyA');
    await page.keyboard.down('KeyD');
    await waitForRoomIndex(page, 1);
    await page.keyboard.up('KeyD');
    const after = await getState(page);
    expect(after.roomIndex).toBe(1);
  });

  test('clicking both branch doors in the same frame advances exactly one room', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);
    const expected = chainSignature(generateStage(SEED));

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    const before = await getState(page);
    expect(before.doors).toHaveLength(2);

    // Two synthetic mousedowns in one JS task: both queue before the next
    // frame's POST_UPDATE, so only the first submitDoor may count.
    // (Wait for the doors to be registered in the input plugin first: the
    // click would otherwise fall in the 1-frame setInteractive window.)
    await waitForDoorsRegistered(page);
    const attemptsBefore = before.doorSubmitAttempts;
    await dispatchTwoDoorClicks(page);
    await waitForRoomIndex(page, 2);
    const after = await getState(page);
    expect(after.roomIndex).toBe(2);
    expect(after.roomType).toBe('combat');
    // Both clicks submitted, but only the first (left door, choice 0) counted.
    expect(after.doorSubmitAttempts - attemptsBefore).toBe(2);
    // The first submit (left door, choice 0) wins; the chain shows chosen 0.
    expect(after.chainSignature).toBe(expected.replace(':null', ':0'));
  });

  test('standing in a branch doorway does not auto-enter; clicking the other door wins', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);
    const expected = chainSignature(generateStage(SEED));

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    const before = await getState(page);
    expect(before.doors).toHaveLength(2);
    const attemptsBefore = before.doorSubmitAttempts;

    // Branch doors no longer fire on overlap: teleport into the left
    // doorway and let several physics steps pass — the room must not
    // change and no submitDoor attempt may be recorded. (Before the fix
    // this is exactly how the left door hijacked a walk to the right door.)
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(740, 478);
    });
    await page.waitForTimeout(500);
    const standing = await getState(page);
    expect(standing.roomIndex).toBe(1);
    expect(standing.doorSubmitAttempts).toBe(attemptsBefore);

    // Clicking the right door still submits directly (choice 1).
    await clickDoor(page, 1);
    await waitForRoomIndex(page, 2);
    const after = await getState(page);
    expect(after.roomIndex).toBe(2);
    // Only the click submitted: the overlap never counted an attempt.
    expect(after.doorSubmitAttempts - attemptsBefore).toBe(1);
    expect(after.roomType).toBe('chest');
    expect(after.chainSignature).toBe(expected.replace(':null', ':1'));
  });

  test('standing in the gap between the two branch doors triggers neither', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    const before = await getState(page);
    expect(before.doors).toHaveLength(2);
    const attemptsBefore = before.doorSubmitAttempts;

    // 两门触发区 [710,770]/[800,860] 之间的中立间隙: 传送到 x=785 (身体
    // [771,799] 两边都不沾), 站 500ms, 哪扇门都不该触发、提交计数不变。
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(785, 478);
    });
    await page.waitForTimeout(500);
    const standing = await getState(page);
    expect(standing.roomIndex).toBe(1);
    expect(standing.doorSubmitAttempts).toBe(attemptsBefore);
  });

  test('clicking a door on its first visible frame still submits', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    // Branch right into the chest room, then click its single door on its
    // first visible frame: the scene-level pointerdown handler must accept
    // the click even if setInteractive has not merged into the plugin's
    // list yet. Arm the click BEFORE triggering the entry: poll (1ms) for
    // the new single door still sitting in _pendingInsertion, and dispatch
    // the click in the SAME task that observes it. A click dispatched after
    // waitForRoomIndex resolves would land after preUpdate already merged
    // the door, and would not test the first-frame path at all.
    const clickedInWindow = page.waitForFunction(
      () => {
        const s = window.__SIDEVIEW_DEBUG__?.getState();
        if (!s || s.doors.length !== 1 || s.pendingInsertionSize === 0) {
          return false;
        }
        const canvas = document.querySelector('canvas');
        if (!canvas) {
          throw new Error('no canvas');
        }
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            clientX: rect.left + (785 / 960) * rect.width,
            clientY: rect.top + (455 / 540) * rect.height,
            button: 0,
          }),
        );
        return true;
      },
      undefined,
      { timeout: 10000, polling: 1 },
    );
    await clickDoor(page, 1);
    await clickedInWindow;
    await waitForRoomIndex(page, 3);
    const after = await getState(page);
    expect(after.roomType).toBe('shop');
  });

  test('a dash into a door leaves gravity working in the next room', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    // Dash into the room-1 SINGLE door ("继续前进", still walk-through):
    // branch doors need an E confirm, so a mid-dash branch entry can no
    // longer happen — the single door keeps the original coverage (the
    // overlap fires mid-dash, so the room changes while the dash still has
    // gravity disabled).
    await clearCurrentRoom(page);
    const before = await getState(page);
    expect(before.doors).toHaveLength(1);

    // Dash (L) into the doorway from just short of it: the overlap fires
    // mid-dash (dash 0.18s at 520px/s covers 93px; the zone starts 51px
    // ahead of the teleport point), so the room changes while the dash
    // still has gravity disabled.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(690, 478);
    });
    expect((await getState(page)).roomIndex).toBe(0);
    await page.keyboard.down('KeyD');
    await page.keyboard.press('KeyL');
    await waitForRoomIndex(page, 1);
    await page.keyboard.up('KeyD');
    const after = await getState(page);
    expect(after.roomType).toBe('combat');

    // The dash lasts 0.18s and the transition happens ~40ms in, so a jump
    // key pressed right after the room change would be swallowed: jump
    // lives in the update loop's else-branch (dashTimer > 0 skips it) and
    // JustDown only lasts one frame. Wait the dash out first.
    await page.waitForTimeout(250);
    // Gravity must work in the new room: jump and land back on the ground.
    // (Without the fix the player rises with no gravity and never lands.)
    // Assert airborne FIRST: grounded && bodyBottom === 500 is already true
    // before the jump, so the landing assertion alone could pass with no
    // jump at all. Hold Space (don't press): a sub-frame down+up is
    // swallowed because Key.onUp clears _justDown before the update loop
    // polls JustDown (same reason the arcade test holds KeyK for 90ms).
    await page.keyboard.down('Space');
    await page.waitForTimeout(100);
    await page.keyboard.up('Space');
    await page.waitForFunction(
      () => (window.__SIDEVIEW_DEBUG__?.getState().bodyBottom ?? 500) < 490,
      undefined,
      { timeout: 5000 },
    );
    await page.waitForFunction(
      () => {
        const s = window.__SIDEVIEW_DEBUG__?.getState();
        return s?.grounded === true && s?.bodyBottom === 500;
      },
      undefined,
      { timeout: 5000 },
    );
  });

  test('chest room coins are collectible', async ({ page }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    await clickDoor(page, 1);
    await waitForRoomIndex(page, 2);
    const before = await getState(page);
    expect(before.roomType).toBe('chest');
    expect(before.enemiesAlive).toBe(0);

    // The chest room's 5 coins sit around x=480: teleport onto them and
    // collect all 5 (pickup radius 40 covers the whole spread).
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(480, 478);
    });
    await page.waitForFunction(
      (coins) => (window.__SIDEVIEW_DEBUG__?.getState().coins ?? 0) >= coins,
      before.coins + 5,
      { timeout: 5000 },
    );
    const after = await getState(page);
    expect(after.coins).toBe(before.coins + 5);
  });

  test('walking into the right branch door enters its room', async ({ page }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    const before = await getState(page);
    expect(before.doors).toHaveLength(2);

    // The right door's overlap is only reachable on foot from the gap
    // between the doors: walking in from the entrance hits the left door
    // first, and a max jump clears only ~31px of horizontal travel above
    // the 90px-tall doorways (door width 60px), so the left door cannot be
    // jumped over from the ground. Teleport into the gap (x=785: body
    // [771,799] clears the left zone [710,770]) and walk right into the
    // right door; the entry itself is by walking + pressing E (branch
    // doors no longer fire on overlap: walking in from the entrance would
    // otherwise hit the left door first — see the test above).
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(785, 478);
    });
    const outcome = await walkRightToX(page, 815, 1);
    expect(outcome).toBe('reached');
    await pressDoorConfirm(page);
    await waitForRoomIndex(page, 2);
    const after = await getState(page);
    expect(after.roomType).toBe('chest');
    expect(after.chainSignature).toBe(
      chainSignature(generateStage(SEED)).replace(':null', ':1'),
    );
  });

  test('walking from the entrance to the right branch door enters its room', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    const before = await getState(page);
    expect(before.doors).toHaveLength(2);

    // Live report: walking right from the room entrance reaches the left
    // door first (zones [710,770] / [800,860] sit side by side), so the
    // right door ("宝箱 · 铜钱") could only be reached by clicking.
    // Walk the whole way from the entrance (x=100, the room-entry spawn)
    // without touching the mouse: the player must pass the left doorway
    // without entering it, arrive at the right doorway, and confirm with E.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(100, 478);
    });
    const outcome = await walkRightToX(page, 815, 1);
    expect(outcome).toBe('reached');
    await pressDoorConfirm(page);
    await waitForRoomIndex(page, 2);
    const after = await getState(page);
    expect(after.roomType).toBe('chest');
    expect(after.chainSignature).toBe(
      chainSignature(generateStage(SEED)).replace(':null', ':1'),
    );
  });

  test('walking into the left branch door enters its room', async ({ page }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    const before = await getState(page);
    expect(before.doors).toHaveLength(2);

    // Branch doors need an E confirm: walk from the entrance to the left
    // doorway (body [721,749] at x=735 strictly overlaps the left zone
    // [710,770]) and press E. Walking on without pressing E must not enter
    // either door — that is what lets the player reach the right door.
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(100, 478);
    });
    const outcome = await walkRightToX(page, 735, 1);
    expect(outcome).toBe('reached');
    await pressDoorConfirm(page);
    await waitForRoomIndex(page, 2);
    const after = await getState(page);
    expect(after.roomType).toBe('combat');
  });

  test('walking up to the doors and clicking the right one enters its room', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    const before = await getState(page);
    expect(before.doors).toHaveLength(2);

    // Walk to just before the left doorway (staying out of its zone), then
    // click the right door. (Walking straight through the left door would
    // trigger it first: a 60x90 doorway cannot be jumped over, max jump
    // clears only ~31px of horizontal travel above 90px height.)
    await page.keyboard.down('KeyD');
    await page.waitForFunction(
      () => (window.__SIDEVIEW_DEBUG__?.getState().x ?? 0) >= 660,
      undefined,
      { timeout: 10000 },
    );
    await page.keyboard.up('KeyD');
    await clickDoor(page, 1);
    await waitForRoomIndex(page, 2);
    const after = await getState(page);
    expect(after.roomType).toBe('chest');
  });

  test('fixed seed produces the same chain on a fresh run', async ({ page }) => {
    await startGame(page, SEED);
    const first = await getState(page);
    expect(first.seed).toBe(SEED);
    expect(first.chainSignature).toBe(chainSignature(generateStage(SEED)));
    expect(first.chainSignature).toContain(':null');
    expect(first.roomCount).toBe(6);

    await startGame(page, SEED);
    const second = await getState(page);
    expect(second.seed).toBe(SEED);
    expect(second.chainSignature).toBe(first.chainSignature);
  });

  test('death then same-seed retry reproduces the chain', async ({ page }) => {
    await startGame(page, SEED);
    const before = await getState(page);

    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.setHp(0);
    });
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().scene === 'GameOverScene',
    );
    const dead = await getState(page);
    expect(dead.seed).toBe(SEED);

    await page.keyboard.press('KeyR');
    await page.waitForFunction(
      () => {
        const s = window.__SIDEVIEW_DEBUG__?.getState();
        return s?.scene === 'SideGameScene' && s.kills === 0 && s.roomIndex === 0;
      },
      undefined,
      { timeout: 10000 },
    );
    const retried = await getState(page);
    expect(retried.seed).toBe(SEED);
    expect(retried.chainSignature).toBe(before.chainSignature);
  });

  test('returning to title and starting a new run uses a different seed', async ({
    page,
  }) => {
    await startGame(page, SEED);
    const first = await getState(page);

    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.setHp(0);
    });
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().scene === 'GameOverScene',
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().scene === 'TitleScene',
    );

    // No page reload: click Start on the title scene just reached, so the
    // test exercises the real return-to-title -> new-run flow (startGame
    // reloads the page and would discard that title scene).
    await page.waitForTimeout(200);
    await clickGamePoint(page, 480, 300);
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().scene === 'SideGameScene',
    );
    const second = await getState(page);
    expect(second.seed).not.toBe(first.seed);
  });

  test('leaving a room with live enemies destroys them and their colliders', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    // Room 0 has 3 template demons; spawn one more right next to the player
    // so a live enemy is in contact range when the room changes. (The
    // normal residue test below clears every room first, so it never
    // exercises clearRoomState's live-enemy destruction path.)
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.spawnEnemyNearPlayer?.();
    });
    const before = await getState(page);
    expect(before.enemiesAlive).toBe(4);

    // Controlled room change with live enemies (debug entry, not a door).
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('chest-1');
    });
    const entered = await getState(page);
    expect(entered.enemiesAlive).toBe(0);
    // The chest room has exactly 3 active colliders (2 persistent player
    // colliders + 1 door overlap); a leaked enemy collider would make it 5.
    // Poll until the physics queue settles instead of reading mid-transition.
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().activeColliders === 3,
      undefined,
      { timeout: 5000 },
    );

    const hpBefore = entered.hp;
    await page.waitForTimeout(2000);
    const after = await getState(page);
    expect(after.enemiesAlive).toBe(0);
    expect(after.hp).toBe(hpBefore);
  });

  test('changing rooms leaves no residue: old enemies gone, no phantom contact damage', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    await clearCurrentRoom(page);
    await advanceRoom(page, 0);
    await clearCurrentRoom(page);
    // Branch right into the chest room (no enemies).
    await clickDoor(page, 1);
    await waitForRoomIndex(page, 2);
    const entered = await getState(page);
    expect(entered.roomType).toBe('chest');
    expect(entered.enemiesAlive).toBe(0);

    // Old rooms' colliders must be gone too: a chest room has exactly 3
    // active colliders (2 persistent player colliders + 1 door overlap).
    // Poll until the physics queue settles instead of reading mid-transition.
    await page.waitForFunction(
      () => window.__SIDEVIEW_DEBUG__?.getState().activeColliders === 3,
      undefined,
      { timeout: 5000 },
    );

    const hpBefore = entered.hp;
    await page.waitForTimeout(2000);
    const after = await getState(page);
    expect(after.enemiesAlive).toBe(0);
    expect(after.hp).toBe(hpBefore);
  });

  test('debug template entry after stage clear resets settlement state', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await startGame(page, SEED);

    await clearStage(page, 0);
    const cleared = await getState(page);
    expect(cleared.stageCleared).toBe(true);

    // Debug entry into a room with enemies: the settlement banner must go
    // away and R/Esc must lock again. (enterTemplate used to leave
    // stageCleared === true with roomCleared === false.)
    await page.evaluate(() => {
      window.__SIDEVIEW_DEBUG__?.enterTemplate?.('combat-1');
    });
    const entered = await getState(page);
    expect(entered.stageCleared).toBe(false);
    expect(entered.roomCleared).toBe(false);

    const kills = entered.kills;
    const roomIndex = entered.roomIndex;
    await page.keyboard.press('KeyR');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const still = await getState(page);
    expect(still.scene).toBe('SideGameScene');
    expect(still.kills).toBe(kills);
    expect(still.roomIndex).toBe(roomIndex);
  });

  test('spawn conversion: every enemy body bottom aligns with its spawn surface and clears platforms', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    for (const template of ROOM_TEMPLATES) {
      if (template.spawns.length === 0) {
        continue;
      }
      // Enter the template and read the body bounds in the SAME evaluate
      // task: the read happens before any physics step, so a mis-anchored
      // spawn cannot be corrected by gravity first (the old 120ms wait hid
      // that). spawnEnemyFromFoot also syncs each body right after sizing it.
      const state = await page.evaluate((id) => {
        window.__SIDEVIEW_DEBUG__?.enterTemplate?.(id);
        const s = window.__SIDEVIEW_DEBUG__?.getState();
        return {
          enemiesAlive: s?.enemiesAlive ?? -1,
          bottoms: s?.enemyBodyBottoms ?? [],
          infos: s?.enemyInfos ?? [],
        };
      }, template.id);
      expect(state.enemiesAlive).toBe(template.spawns.length);
      expect(state.bottoms).toHaveLength(template.spawns.length);
      template.spawns.forEach((spawn, i) => {
        const info = state.infos[i];
        expect(
          Math.abs((state.bottoms[i] as number) - spawn.surfaceY),
          `${template.id} spawn ${i} should sit on ${spawn.surfaceY}`,
        ).toBeLessThanOrEqual(2);
        expect(
          info.bodyRight - info.bodyLeft,
          `${template.id} spawn ${i} (${spawn.kind}) width should be 28`,
        ).toBe(28);
        expect(
          info.bodyBottom - info.bodyTop,
          `${template.id} spawn ${i} (${spawn.kind}) height should be 46`,
        ).toBe(46);
        for (const p of template.platforms) {
          const pLeft = p.x - p.w / 2;
          const pRight = p.x + p.w / 2;
          const pTop = p.y - p.h / 2;
          const pBottom = p.y + p.h / 2;
          const overlapsPlatform =
            info.bodyLeft < pRight &&
            info.bodyRight > pLeft &&
            info.bodyTop < pBottom &&
            info.bodyBottom > pTop;
          expect(
            overlapsPlatform,
            `${template.id} spawn ${i} (${spawn.kind}) body [${info.bodyLeft},${info.bodyTop},${info.bodyRight},${info.bodyBottom}] should not intersect platform [${pLeft},${pTop},${pRight},${pBottom}]`,
          ).toBe(false);
        }
      });
    }
  });

  test('arcade walk-jump acceptance: every platform of every template is reachable', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await startGame(page, SEED);

    const ground = { top: 500, minX: 78, maxX: 882 };
    const surfaceOf = (p: { x: number; y: number; w: number; h: number }) => ({
      top: p.y - p.h / 2,
      minX: p.x - p.w / 2 + 14,
      maxX: p.x + p.w / 2 - 14,
    });

    for (const template of ROOM_TEMPLATES) {
      await page.evaluate((id) => {
        window.__SIDEVIEW_DEBUG__?.enterTemplate?.(id);
      }, template.id);
      await page.evaluate(() => {
        window.__SIDEVIEW_DEBUG__?.setHp(30);
      });
      await page.waitForTimeout(120);

      // The plan must cover every platform, or the loop below would
      // silently skip an unreachable one.
      expect(jumpPlan(template)).toHaveLength(template.platforms.length);

      for (const step of jumpPlan(template)) {
        const from =
          step.fromIndex === null ? ground : surfaceOf(template.platforms[step.fromIndex]);
        const target = surfaceOf(template.platforms[step.platformIndex]);
        const targetCenter = (target.minX + target.maxX) / 2;
        const overlaps = target.minX <= from.maxX && from.minX <= target.maxX;
        const standX = overlaps
          ? Math.max(from.minX, Math.min(from.maxX, targetCenter))
          : targetCenter > (from.minX + from.maxX) / 2
            ? from.maxX - 4
            : from.minX + 4;
        const moveKey = overlaps ? null : targetCenter > standX ? 'KeyD' : 'KeyA';
        const upward = target.top < from.top;

        await page.evaluate(
          ([x, y]) => {
            window.__SIDEVIEW_DEBUG__?.teleportPlayer?.(x, y);
          },
          [standX, from.top - 22],
        );
        await page.waitForTimeout(150);
        // Takeoff check: the player must actually be standing on the
        // planned `from` surface before the jump, or the landing assertion
        // below would pass for a jump from the wrong surface.
        const takeoff = await getState(page);
        expect(
          takeoff.grounded,
          `${template.id} platform ${step.platformIndex}: player should be grounded on the takeoff surface`,
        ).toBe(true);
        expect(
          Math.abs(takeoff.bodyBottom - from.top),
          `${template.id} platform ${step.platformIndex}: body bottom should be on takeoff surface ${from.top}, got ${takeoff.bodyBottom}`,
        ).toBeLessThanOrEqual(3);
        if (moveKey) {
          await page.keyboard.down(moveKey);
        }
        if (upward) {
          await page.keyboard.down('KeyK');
          await page.waitForTimeout(90);
          await page.keyboard.up('KeyK');
        }
        await page.waitForTimeout(650);
        if (moveKey) {
          await page.keyboard.up(moveKey);
        }
        await page.waitForTimeout(150);

        const state = await getState(page);
        expect(
          state.grounded,
          `${template.id} platform ${step.platformIndex}: player should be grounded after the jump`,
        ).toBe(true);
        expect(
          Math.abs(state.bodyBottom - target.top),
          `${template.id} platform ${step.platformIndex}: body bottom should be on ${target.top}, got ${state.bodyBottom}`,
        ).toBeLessThanOrEqual(3);
      }
    }
  });

  test('HUD room progress follows the room index', async ({ page }) => {
    test.setTimeout(180000);
    await startGame(page, SEED);

    // Walk through all 6 rooms via chest route (includes room 3 chest & room 4 shop).
    for (let i = 0; i < 6; i += 1) {
      const state = await getState(page);
      expect(state.roomIndex).toBe(i);
      expect(state.roomCount).toBe(6);
      expect(state.hudRoomText).toBe(`夜巷 ${i + 1}/6`);

      if (state.roomType === 'shop') {
        // Shop auto-clears on entry; verify HUD does not skip 4/6.
        expect(state.roomCleared).toBe(true);
        await page.waitForTimeout(300);
        const afterWait = await getState(page);
        expect(afterWait.roomIndex).toBe(3);
        expect(afterWait.hudRoomText).toBe('夜巷 4/6');
      }

      await clearCurrentRoom(page);
      const cleared = await getState(page);
      if (cleared.stageCleared) {
        expect(i).toBe(5);
        break;
      }
      await advanceRoom(page, i === 1 ? 1 : 0);
    }
  });

  test('no HP loss within 2s of entering each room template without input', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await startGame(page, SEED);

    for (const template of ROOM_TEMPLATES) {
      // 同一次 evaluate 内读 bodyBottom：进房调用一返回就读，中间无物理帧，
      // 连一次短下落也藏不住（100ms 后的断言只能排除较长的下落）。
      // 实测：进房瞬间 bodyBottom 是 494，不是 500——reset 把玩家放在地面上 6px 处，
      // 第一个物理步再落 6px 到 500（游戏无坠落伤害，这 6px 不掉血）。断言下限 490，
      // 即出生点离地不超过 10px；若有人把出生点改到高处，这里会立刻失败。
      const immediateBottom = await page.evaluate((id) => {
        window.__SIDEVIEW_DEBUG__?.enterTemplate?.(id);
        window.__SIDEVIEW_DEBUG__?.setHp(30);
        return window.__SIDEVIEW_DEBUG__?.getState().bodyBottom;
      }, template.id);
      expect(
        immediateBottom,
        `${template.id}: player should start at most 10px above ground (no fall)`,
      ).toBeGreaterThanOrEqual(490);
      expect(
        immediateBottom,
        `${template.id}: player should start at or above ground level`,
      ).toBeLessThanOrEqual(500);
      await page.waitForTimeout(100);
      const entry = await getState(page);
      expect(
        entry.roomTemplateId,
        `${template.id}: enterTemplate should have entered this template`,
      ).toBe(template.id);
      expect(
        entry.grounded,
        `${template.id}: player should be grounded on entry`,
      ).toBe(true);
      expect(
        entry.bodyBottom,
        `${template.id}: player should start on ground y=500`,
      ).toBe(500);

      await page.waitForTimeout(2000);
      const after = await getState(page);
      expect(
        after.hp,
        `${template.id}: player should not lose HP within 2s of entry without input`,
      ).toBe(30);
    }
  });
});
